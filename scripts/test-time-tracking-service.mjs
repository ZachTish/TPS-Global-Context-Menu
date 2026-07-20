import assert from 'node:assert/strict';
import test from 'node:test';
import { TFile } from 'obsidian';
import { TimeTrackingService } from '../src/services/time-tracking-service.ts';

const STARTED_AT = '2026-07-20T05:00:00.000Z';
const ENDED_AT = '2026-07-20T05:45:00.000Z';

function activeNoteSession(overrides = {}) {
  return {
    id: 'gcm-workout-owned',
    targetId: 'workout-original',
    targetType: 'note',
    sourcePath: 'Health/Workouts/Strength.md',
    start: STARTED_AT,
    createdAt: STARTED_AT,
    updatedAt: STARTED_AT,
    ...overrides,
  };
}

function createHarness(filesWithFrontmatter, options = {}) {
  const files = filesWithFrontmatter.map(({ path }) => new TFile(path));
  const frontmatterByPath = new Map(
    filesWithFrontmatter.map(({ path, frontmatter }) => [path, structuredClone(frontmatter)]),
  );
  const mutationPaths = [];
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const applyMutation = async (file, mutate, guarded) => {
    mutationPaths.push(file.path);
    options.beforeMutation?.(file, frontmatterByPath);
    const frontmatter = frontmatterByPath.get(file.path) ?? {};
    const before = structuredClone(frontmatter);
    const decision = await mutate(frontmatter);
    if ((guarded && decision !== true) || options.refuseMutation?.(file)) {
      frontmatterByPath.set(file.path, before);
      return false;
    }
    frontmatterByPath.set(file.path, frontmatter);
    return JSON.stringify(before) !== JSON.stringify(frontmatter);
  };
  const plugin = {
    settings: {
      enableTimeTracking: false,
      timeTrackingIgnoreArchivedFiles: true,
      timeTrackingPropertyKey: 'timeTracking',
      timeTrackingStorageMode: 'daily-note',
    },
    app: {
      vault: {
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (path) => fileByPath.get(path) ?? null,
        cachedRead: async () => '',
        read: async (file) => `---\n${JSON.stringify(frontmatterByPath.get(file.path) ?? {})}\n---\n`,
      },
      metadataCache: {
        getFileCache: (file) => ({ frontmatter: frontmatterByPath.get(file.path) }),
      },
      workspace: {},
    },
    frontmatterMutationService: {
      async process(file, mutate) {
        return applyMutation(file, mutate, false);
      },
      async processGuarded(file, mutate) {
        return applyMutation(file, mutate, true);
      },
    },
    getArchiveFolderPath: () => '_archive',
    eventService: { emitFilesUpdated() {} },
    timeTrackingStatusBarService: { refresh() {} },
  };
  return {
    plugin,
    service: new TimeTrackingService(plugin),
    frontmatterByPath,
    mutationPaths,
  };
}

test('exact owned cleanup reaches a moved archived target and archived storage while tracking is disabled', async () => {
  const record = activeNoteSession();
  const archivedTargetPath = '_archive/Health/Strength.md';
  const archivedStoragePath = '_archive/Timer Storage/2026-07-20.md';
  const harness = createHarness([
    {
      path: record.sourcePath,
      frontmatter: { title: 'ID-less replacement' },
    },
    {
      path: archivedTargetPath,
      frontmatter: { tpsId: record.targetId, title: 'Strength archive' },
    },
    {
      path: archivedStoragePath,
      frontmatter: { timeTracking: [record] },
    },
  ]);

  const stopped = await harness.service.stopActiveNoteTimerByIdForPath(
    record.sourcePath,
    record.id,
    ENDED_AT,
  );

  assert.equal(stopped?.id, record.id);
  assert.equal(new Date(stopped?.end).getTime(), new Date(ENDED_AT).getTime());
  assert.equal(
    new Date(harness.frontmatterByPath.get(archivedStoragePath).timeTracking[0].end).getTime(),
    new Date(ENDED_AT).getTime(),
  );
  assert.ok(harness.mutationPaths.includes(archivedStoragePath));
  assert.ok(harness.mutationPaths.includes(archivedTargetPath));
  assert.ok(!harness.mutationPaths.includes(record.sourcePath));
});

test('exact cleanup stops stored ownership without mutating a different note that reused the source path', async () => {
  const record = activeNoteSession();
  const replacementFrontmatter = {
    tpsId: 'replacement-note',
    title: 'Unrelated replacement',
    scheduled: 'keep-me',
    timeEstimate: 99,
  };
  const storagePath = 'Timer Storage/2026-07-20.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: replacementFrontmatter },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
  ]);

  const stopped = await harness.service.stopActiveNoteTimerByIdForPath(
    record.sourcePath,
    record.id,
    ENDED_AT,
  );

  assert.equal(stopped?.id, record.id);
  assert.equal(new Date(stopped?.end).getTime(), new Date(ENDED_AT).getTime());
  assert.deepEqual(harness.frontmatterByPath.get(record.sourcePath), replacementFrontmatter);
  assert.deepEqual(harness.mutationPaths, [storagePath]);
});

test('exact cleanup finds an owned record after the configured property key changes', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/Old Property Key.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: { tpsId: record.targetId } },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
  ]);
  harness.plugin.settings.timeTrackingPropertyKey = 'workSessions';

  const stopped = await harness.service.stopActiveNoteTimerByIdForPath(
    record.sourcePath,
    record.id,
    ENDED_AT,
  );

  assert.equal(stopped?.id, record.id);
  assert.ok(harness.frontmatterByPath.get(storagePath).timeTracking[0].end);
  assert.equal(harness.frontmatterByPath.get(storagePath).workSessions, undefined);
});

test('a post-commit projection failure does not make durable exact cleanup ambiguous', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/Projection Failure.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: { tpsId: record.targetId } },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
  ], {
    beforeMutation(file) {
      if (file.path === record.sourcePath) throw new Error('synthetic projection failure');
    },
  });

  const stopped = await harness.service.stopActiveNoteTimerByIdForPath(
    record.sourcePath,
    record.id,
    ENDED_AT,
  );

  assert.equal(stopped?.id, record.id);
  assert.ok(harness.frontmatterByPath.get(storagePath).timeTracking[0].end);
});

test('exact cleanup preserves malformed siblings and forward-compatible fields while ending only its record', async () => {
  const record = activeNoteSession({ futureMetadata: { keep: true } });
  const sibling = activeNoteSession({
    id: 'manual-sibling',
    targetId: 'manual-target',
    sourcePath: 'Notes/Manual.md',
    futureMetadata: { nested: ['keep'] },
  });
  const storagePath = 'Timer Storage/Heterogeneous.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: { tpsId: record.targetId } },
    { path: storagePath, frontmatter: { timeTracking: [sibling, 'keep-me', record] } },
  ]);
  const originalSibling = structuredClone(sibling);

  const stopped = await harness.service.stopActiveNoteTimerByIdForPath(
    record.sourcePath,
    record.id,
    ENDED_AT,
  );

  const entries = harness.frontmatterByPath.get(storagePath).timeTracking;
  assert.equal(stopped?.id, record.id);
  assert.deepEqual(entries[0], originalSibling);
  assert.equal(entries[1], 'keep-me');
  assert.deepEqual(entries[2].futureMetadata, { keep: true });
  assert.ok(entries[2].end);
});

test('exact cleanup does not report settlement when the storage mutation is refused', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/2026-07-20.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: { tpsId: record.targetId } },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
  ], {
    refuseMutation: (file) => file.path === storagePath,
  });

  const stopped = await harness.service.stopActiveNoteTimerByIdForPath(
    record.sourcePath,
    record.id,
    ENDED_AT,
  );

  assert.equal(stopped, null);
  assert.equal(harness.frontmatterByPath.get(storagePath).timeTracking[0].end, undefined);
  assert.deepEqual(harness.mutationPaths, [storagePath]);
});

test('exact cleanup atomically rechecks target identity before metadata sync', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/2026-07-20.md';
  let replaced = false;
  const harness = createHarness([
    {
      path: record.sourcePath,
      frontmatter: { tpsId: record.targetId, scheduled: 'keep-me', timeEstimate: 99 },
    },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
  ], {
    beforeMutation(file, frontmatterByPath) {
      if (file.path !== record.sourcePath || replaced) return;
      replaced = true;
      frontmatterByPath.set(file.path, {
        tpsId: 'replacement-note',
        scheduled: 'keep-me',
        timeEstimate: 99,
      });
    },
  });

  const stopped = await harness.service.stopActiveNoteTimerByIdForPath(
    record.sourcePath,
    record.id,
    ENDED_AT,
  );

  assert.equal(stopped?.id, record.id);
  assert.deepEqual(harness.frontmatterByPath.get(record.sourcePath), {
    tpsId: 'replacement-note',
    scheduled: 'keep-me',
    timeEstimate: 99,
  });
});

test('exact cleanup reads durable storage when metadata cache still lacks the owned record', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/2026-07-20.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: { tpsId: record.targetId } },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
  ]);
  harness.service.plugin.app.metadataCache.getFileCache = (file) => ({
    frontmatter: file.path === storagePath
      ? { timeTracking: [] }
      : harness.frontmatterByPath.get(file.path),
  });

  const stopped = await harness.service.stopActiveNoteTimerByIdForPath(
    record.sourcePath,
    record.id,
    ENDED_AT,
  );

  assert.equal(stopped?.id, record.id);
  assert.ok(harness.frontmatterByPath.get(storagePath).timeTracking[0].end);
});

test('exact cleanup skips target projection when duplicate note identities make a moved target ambiguous', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/2026-07-20.md';
  const duplicateOne = 'Health/Workouts/Duplicate One.md';
  const duplicateFrontmatter = { tpsId: record.targetId, scheduled: 'keep-me', timeEstimate: 99 };
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: duplicateFrontmatter },
    { path: duplicateOne, frontmatter: duplicateFrontmatter },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
  ]);
  harness.plugin.app.metadataCache.getFileCache = (file) => ({
    frontmatter: file.path === duplicateOne ? {} : harness.frontmatterByPath.get(file.path),
  });

  const stopped = await harness.service.stopActiveNoteTimerByIdForPath(
    record.sourcePath,
    record.id,
    ENDED_AT,
  );

  assert.equal(stopped?.id, record.id);
  assert.deepEqual(harness.frontmatterByPath.get(duplicateOne), duplicateFrontmatter);
  assert.deepEqual(harness.frontmatterByPath.get(record.sourcePath), duplicateFrontmatter);
  assert.deepEqual(harness.mutationPaths, [storagePath]);
});

test('exact ownership queries reject an unreadable authoritative file instead of trusting stale cache absence', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/Unreadable.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: { tpsId: record.targetId } },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
  ]);
  const read = harness.plugin.app.vault.read;
  harness.plugin.app.vault.read = async (file) => {
    if (file.path === storagePath) throw new Error('synthetic read failure');
    return read(file);
  };
  harness.plugin.app.metadataCache.getFileCache = (file) => ({
    frontmatter: file.path === storagePath ? { timeTracking: [] } : harness.frontmatterByPath.get(file.path),
  });

  await assert.rejects(
    harness.service.getActiveNoteTimersForPath(record.sourcePath),
    /could not read authoritative storage/i,
  );
});

test('exact ownership queries reject malformed authoritative frontmatter', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/Malformed.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: { tpsId: record.targetId } },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
  ]);
  const read = harness.plugin.app.vault.read;
  harness.plugin.app.vault.read = async (file) => (
    file.path === storagePath ? '---\n{broken\n---\n' : read(file)
  );

  await assert.rejects(
    harness.service.getActiveNoteTimersForPath(record.sourcePath),
    /could not parse authoritative frontmatter/i,
  );
});

test('exact ownership scans accept BOM-prefixed authoritative storage with an empty cache', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/BOM.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: { tpsId: record.targetId } },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
  ]);
  const read = harness.plugin.app.vault.read;
  harness.plugin.app.vault.read = async (file) => `\uFEFF${await read(file)}`;
  harness.plugin.app.metadataCache.getFileCache = () => ({ frontmatter: {} });

  const active = await harness.service.getActiveNoteTimersForPath(record.sourcePath);

  assert.deepEqual(active.map((session) => session.id), [record.id]);
});

test('exact ownership scans accept unrelated empty or comment-only frontmatter', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/Owned.md';
  const emptyPath = 'Notes/Empty Frontmatter.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: { tpsId: record.targetId } },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
    { path: emptyPath, frontmatter: {} },
  ]);
  const read = harness.plugin.app.vault.read;
  harness.plugin.app.vault.read = async (file) => file.path === emptyPath
    ? '---\n# intentionally empty\n---\nbody\n'
    : read(file);

  const sessions = await harness.service.getTimerSessionsById(record.id);

  assert.deepEqual(sessions.map((session) => session.id), [record.id]);
});

test('exact ownership scans do not treat a longer opening marker as frontmatter', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/Owned Exact Delimiter.md';
  const unrelatedPath = 'Notes/Four Dashes.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: { tpsId: record.targetId } },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
    { path: unrelatedPath, frontmatter: { timeTracking: [record] } },
  ]);
  const read = harness.plugin.app.vault.read;
  harness.plugin.app.vault.read = async (file) => file.path === unrelatedPath
    ? '----\nnot frontmatter\n---\nbody\n'
    : read(file);

  const sessions = await harness.service.getTimerSessionsById(record.id);

  assert.deepEqual(sessions.map((session) => session.storagePath), [storagePath]);
});

test('exact ownership scans reject a non-delimiter closing prefix', async () => {
  const record = activeNoteSession();
  const storagePath = 'Timer Storage/Owned Before Malformed.md';
  const malformedPath = 'Notes/Closing Prefix.md';
  const harness = createHarness([
    { path: record.sourcePath, frontmatter: { tpsId: record.targetId } },
    { path: storagePath, frontmatter: { timeTracking: [record] } },
    { path: malformedPath, frontmatter: {} },
  ]);
  const read = harness.plugin.app.vault.read;
  harness.plugin.app.vault.read = async (file) => file.path === malformedPath
    ? '---\ntitle: malformed\n---not-a-delimiter\nbody\n'
    : read(file);

  await assert.rejects(
    harness.service.getTimerSessionsById(record.id),
    /malformed authoritative frontmatter/i,
  );
});

test('timer start returns null when the target identity or session record write is not confirmed', async () => {
  const targetPath = 'Health/Workouts/Refused Start.md';
  const targetId = 'workout-refused-start';
  for (const existingIdentity of [false, true]) {
    let mutationCount = 0;
    const harness = createHarness([{
      path: targetPath,
      frontmatter: existingIdentity ? { tpsId: targetId, timeTracking: [] } : {},
    }], {
      refuseMutation() {
        mutationCount += 1;
        return existingIdentity || mutationCount === 1;
      },
    });
    harness.plugin.settings.enableTimeTracking = true;
    harness.plugin.settings.timeTrackingStorageMode = 'source-note';
    harness.plugin.settings.timeTrackingSingleActiveSession = false;
    const file = harness.plugin.app.vault.getAbstractFileByPath(targetPath);

    const started = await harness.service.startTimer({
      file,
      type: 'note',
      title: 'Refused Start',
      sessionId: `gcm-refused-${existingIdentity ? 'record' : 'identity'}`,
      startedAt: STARTED_AT,
    });

    assert.equal(started, null);
    assert.equal(harness.frontmatterByPath.get(targetPath).timeTracking?.length ?? 0, 0);
  }
});

test('timer start preserves an authoritative target identity hidden by stale metadata cache', async () => {
  const targetPath = 'Health/Workouts/Authoritative Identity.md';
  const targetId = 'workout-authoritative-identity';
  const sessionId = 'gcm-authoritative-identity';
  const harness = createHarness([{
    path: targetPath,
    frontmatter: { tpsId: targetId, timeTracking: [] },
  }]);
  harness.plugin.settings.enableTimeTracking = true;
  harness.plugin.settings.timeTrackingStorageMode = 'source-note';
  harness.plugin.settings.timeTrackingSingleActiveSession = false;
  harness.plugin.app.metadataCache.getFileCache = () => ({ frontmatter: { timeTracking: [] } });
  const file = harness.plugin.app.vault.getAbstractFileByPath(targetPath);

  const started = await harness.service.startTimer({
    file,
    type: 'note',
    title: 'Authoritative Identity',
    sessionId,
    startedAt: STARTED_AT,
  });

  assert.equal(started?.id, sessionId);
  assert.equal(harness.frontmatterByPath.get(targetPath).tpsId, targetId);
  assert.equal(harness.frontmatterByPath.get(targetPath).timeTracking[0].targetId, targetId);
});

test('timer start uses authoritative target identity when metadata cache contains an obsolete ID', async () => {
  const targetPath = 'Health/Workouts/Corrected Identity.md';
  const targetId = 'workout-corrected-identity';
  const sessionId = 'gcm-corrected-identity';
  const harness = createHarness([{
    path: targetPath,
    frontmatter: { tpsId: targetId, timeTracking: [] },
  }]);
  harness.plugin.settings.enableTimeTracking = true;
  harness.plugin.settings.timeTrackingStorageMode = 'source-note';
  harness.plugin.settings.timeTrackingSingleActiveSession = false;
  harness.plugin.app.metadataCache.getFileCache = () => ({
    frontmatter: { tpsId: 'obsolete-cache-id', timeTracking: [] },
  });
  const file = harness.plugin.app.vault.getAbstractFileByPath(targetPath);

  const started = await harness.service.startTimer({
    file,
    type: 'note',
    title: 'Corrected Identity',
    sessionId,
    startedAt: STARTED_AT,
  });

  assert.equal(started?.id, sessionId);
  assert.equal(harness.frontmatterByPath.get(targetPath).tpsId, targetId);
  assert.equal(harness.frontmatterByPath.get(targetPath).timeTracking[0].targetId, targetId);
});

test('timer start appends without rewriting existing raw session entries', async () => {
  const targetPath = 'Health/Workouts/Raw Append.md';
  const targetId = 'workout-raw-append';
  const sessionId = 'gcm-raw-append';
  const sibling = activeNoteSession({
    id: 'completed-sibling',
    targetId: 'manual-target',
    sourcePath: 'Notes/Manual.md',
    end: ENDED_AT,
    futureMetadata: { keep: ['exactly'] },
  });
  const harness = createHarness([{
    path: targetPath,
    frontmatter: { tpsId: targetId, timeTracking: [sibling, 'keep-me'] },
  }]);
  harness.plugin.settings.enableTimeTracking = true;
  harness.plugin.settings.timeTrackingStorageMode = 'source-note';
  harness.plugin.settings.timeTrackingSingleActiveSession = false;
  const file = harness.plugin.app.vault.getAbstractFileByPath(targetPath);
  const originalSibling = structuredClone(sibling);

  const started = await harness.service.startTimer({
    file,
    type: 'note',
    title: 'Raw Append',
    sessionId,
    startedAt: STARTED_AT,
  });

  const entries = harness.frontmatterByPath.get(targetPath).timeTracking;
  assert.equal(started?.id, sessionId);
  assert.deepEqual(entries[0], originalSibling);
  assert.equal(entries[1], 'keep-me');
  assert.equal(entries[2].id, sessionId);
});

test('exact timer start returns its durable session when a post-commit cache refresh fails', async () => {
  const targetPath = 'Health/Workouts/Post Commit Start.md';
  const targetId = 'workout-post-commit-start';
  const sessionId = 'gcm-post-commit-start';
  const harness = createHarness([{
    path: targetPath,
    frontmatter: { tpsId: targetId, timeTracking: [] },
  }]);
  harness.plugin.settings.enableTimeTracking = true;
  harness.plugin.settings.timeTrackingStorageMode = 'source-note';
  harness.plugin.settings.timeTrackingSingleActiveSession = false;
  harness.service.refreshActiveTimerCache = async () => {
    throw new Error('synthetic post-commit cache failure');
  };
  const file = harness.plugin.app.vault.getAbstractFileByPath(targetPath);

  const started = await harness.service.startTimer({
    file,
    type: 'note',
    title: 'Post Commit Start',
    sessionId,
    startedAt: STARTED_AT,
  });

  assert.equal(started?.id, sessionId);
  assert.equal(harness.frontmatterByPath.get(targetPath).timeTracking[0].id, sessionId);
});

test('exact timer start skips projection when target identity changes after durable storage selection', async () => {
  const targetPath = 'Health/Workouts/Reused During Start.md';
  const targetId = 'workout-reused-during-start';
  const storagePath = 'Timer Storage/Dedicated.md';
  const sessionId = 'gcm-reused-during-start';
  let replaced = false;
  const harness = createHarness([
    {
      path: targetPath,
      frontmatter: { tpsId: targetId, scheduled: 'keep-me', timeEstimate: 99 },
    },
    { path: storagePath, frontmatter: { timeTracking: [] } },
  ], {
    beforeMutation(file, frontmatterByPath) {
      if (replaced || file.path !== storagePath) return;
      replaced = true;
      frontmatterByPath.set(targetPath, {
        tpsId: 'replacement-target',
        scheduled: 'keep-me',
        timeEstimate: 99,
      });
    },
  });
  harness.plugin.settings.enableTimeTracking = true;
  harness.plugin.settings.timeTrackingStorageMode = 'dedicated-note';
  harness.plugin.settings.timeTrackingDedicatedNotePath = storagePath;
  harness.plugin.settings.timeTrackingSingleActiveSession = false;
  const file = harness.plugin.app.vault.getAbstractFileByPath(targetPath);

  const started = await harness.service.startTimer({
    file,
    type: 'note',
    title: 'Reused During Start',
    sessionId,
    startedAt: STARTED_AT,
  });

  assert.equal(started?.id, sessionId);
  assert.deepEqual(harness.frontmatterByPath.get(targetPath), {
    tpsId: 'replacement-target',
    scheduled: 'keep-me',
    timeEstimate: 99,
  });
  assert.equal(harness.frontmatterByPath.get(storagePath).timeTracking.length, 1);
});

test('exact timer start declines without prompting when an unrelated timer is already active', async () => {
  const targetPath = 'Health/Workouts/Second Automatic.md';
  const targetId = 'workout-second-automatic';
  const existing = activeNoteSession({
    id: 'manual-active',
    targetId,
    sourcePath: targetPath,
  });
  const harness = createHarness([{
    path: targetPath,
    frontmatter: { tpsId: targetId, timeTracking: [existing] },
  }]);
  harness.plugin.settings.enableTimeTracking = true;
  harness.plugin.settings.timeTrackingStorageMode = 'source-note';
  const file = harness.plugin.app.vault.getAbstractFileByPath(targetPath);

  const started = await harness.service.startTimer({
    file,
    type: 'note',
    title: 'Second Automatic',
    sessionId: 'gcm-second-automatic',
    startedAt: STARTED_AT,
  });

  assert.equal(started, null);
  assert.deepEqual(
    harness.frontmatterByPath.get(targetPath).timeTracking.map((session) => session.id),
    ['manual-active'],
  );
});

test('timer start refuses a duplicate session identity introduced at the storage write boundary', async () => {
  const targetPath = 'Health/Workouts/Atomic Duplicate.md';
  const targetId = 'workout-atomic-duplicate';
  const sessionId = 'gcm-atomic-duplicate';
  let targetMutationCount = 0;
  const harness = createHarness([{
    path: targetPath,
    frontmatter: { tpsId: targetId, timeTracking: [] },
  }], {
    beforeMutation(file, frontmatterByPath) {
      if (file.path !== targetPath) return;
      targetMutationCount += 1;
      if (targetMutationCount !== 2) return;
      frontmatterByPath.get(targetPath).timeTracking.push(activeNoteSession({
        id: sessionId,
        targetId,
        sourcePath: targetPath,
      }));
    },
  });
  harness.plugin.settings.enableTimeTracking = true;
  harness.plugin.settings.timeTrackingStorageMode = 'source-note';
  harness.plugin.settings.timeTrackingSingleActiveSession = false;
  const file = harness.plugin.app.vault.getAbstractFileByPath(targetPath);

  const started = await harness.service.startTimer({
    file,
    type: 'note',
    title: 'Atomic Duplicate',
    sessionId,
    startedAt: STARTED_AT,
  });

  assert.equal(started, null);
  assert.equal(harness.frontmatterByPath.get(targetPath).timeTracking.length, 1);
  assert.equal(harness.frontmatterByPath.get(targetPath).timeTracking[0].id, sessionId);
});

test('timer start refuses a boundary duplicate under an alternate property key without adding its configured record', async () => {
  const targetPath = 'Health/Workouts/Alternate Key Duplicate.md';
  const targetId = 'workout-alternate-key-duplicate';
  const sessionId = 'gcm-alternate-key-duplicate';
  let targetMutationCount = 0;
  const harness = createHarness([{
    path: targetPath,
    frontmatter: { tpsId: targetId, tags: 'keep-noncanonical', timeTracking: [] },
  }], {
    beforeMutation(file, frontmatterByPath) {
      if (file.path !== targetPath) return;
      targetMutationCount += 1;
      if (targetMutationCount !== 2) return;
      frontmatterByPath.get(targetPath).legacySessions = [activeNoteSession({
        id: sessionId,
        targetId,
        sourcePath: targetPath,
      })];
    },
  });
  harness.plugin.settings.enableTimeTracking = true;
  harness.plugin.settings.timeTrackingStorageMode = 'source-note';
  harness.plugin.settings.timeTrackingSingleActiveSession = false;
  const file = harness.plugin.app.vault.getAbstractFileByPath(targetPath);

  const started = await harness.service.startTimer({
    file,
    type: 'note',
    title: 'Alternate Key Duplicate',
    sessionId,
    startedAt: STARTED_AT,
  });

  const frontmatter = harness.frontmatterByPath.get(targetPath);
  assert.equal(started, null);
  assert.equal(frontmatter.tags, 'keep-noncanonical');
  assert.deepEqual(frontmatter.timeTracking, []);
  assert.equal(frontmatter.legacySessions.length, 1);
  assert.equal(frontmatter.legacySessions[0].id, sessionId);
});

test('sequential same-ID starts use durable storage when metadata cache lags the first write', async () => {
  const targetPath = 'Health/Workouts/Stale Cache Start.md';
  const targetId = 'workout-stale-cache-start';
  const sessionId = 'gcm-stale-cache-start';
  const harness = createHarness([{
    path: targetPath,
    frontmatter: { tpsId: targetId, timeTracking: [] },
  }]);
  harness.plugin.settings.enableTimeTracking = true;
  harness.plugin.settings.timeTrackingStorageMode = 'source-note';
  harness.plugin.settings.timeTrackingSingleActiveSession = false;
  harness.plugin.app.metadataCache.getFileCache = () => ({
    frontmatter: { tpsId: targetId, timeTracking: [] },
  });
  const file = harness.plugin.app.vault.getAbstractFileByPath(targetPath);
  const input = {
    file,
    type: 'note',
    title: 'Stale Cache Start',
    sessionId,
    startedAt: STARTED_AT,
  };

  const first = await harness.service.startTimer(input);
  const second = await harness.service.startTimer(input);

  assert.equal(first?.id, sessionId);
  assert.equal(second?.id, sessionId);
  assert.equal(harness.frontmatterByPath.get(targetPath).timeTracking.length, 1);
});
