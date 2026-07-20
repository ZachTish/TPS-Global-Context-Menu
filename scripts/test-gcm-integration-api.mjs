import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

async function loadPure(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const file = Object.freeze({ path: 'Health/Workouts/Strength.md' });
const now = Date.parse('2026-07-20T06:00:00.000Z');
const startRequest = Object.freeze({
  path: file.path,
  title: 'Strength',
  sessionId: 'gcm-workout-one',
  startedAt: '2026-07-20T05:00:00.000Z',
});
const stopRequest = Object.freeze({
  path: file.path,
  sessionId: startRequest.sessionId,
  endedAt: '2026-07-20T05:30:00.000Z',
});

function noteSession(overrides = {}) {
  return Object.freeze({
    id: startRequest.sessionId,
    targetType: 'note',
    targetPath: file.path,
    sourcePath: file.path,
    start: '2026-07-20T05:00:00.000Z',
    ...overrides,
  });
}

function createDependencies(overrides = {}) {
  return {
    registerExternalAction() {
      return () => undefined;
    },
    resolveMarkdownFile(path) {
      return path === file.path ? file : undefined;
    },
    async openFile() {
      return true;
    },
    isTimeTrackingEnabled() {
      return true;
    },
    async getTimerSessionsById() {
      return [];
    },
    async startNoteTimer(_file, _title, sessionId) {
      return noteSession({ id: sessionId });
    },
    async stopActiveNoteTimerByIdForPath(_path, sessionId, endedAt) {
      return noteSession({ id: sessionId, end: endedAt.toISOString() });
    },
    now() {
      return now;
    },
    ...overrides,
  };
}

test('external action tuple keys cannot collide and callbacks remain generation-fenced', async () => {
  const {
    createGcmExternalActionRegistrationKey,
    createTPSGcmIntegrationApi,
  } = await loadPure('../src/tps-gcm-integration-api.ts');
  assert.notEqual(
    createGcmExternalActionRegistrationKey('a:b', 'c'),
    createGcmExternalActionRegistrationKey('a', 'b:c'),
  );

  let current = true;
  let registered;
  let disposeCalls = 0;
  const api = createTPSGcmIntegrationApi(createDependencies({
    registerExternalAction(action) {
      registered = action;
      return () => {
        disposeCalls += 1;
      };
    },
  }), () => {
    if (!current) throw new Error('stale generation');
  });
  const clicks = [];
  const dispose = api.registerExternalAction({
    id: 'food-log',
    pluginId: 'tps-health',
    order: 15,
    icon: 'apple',
    label: 'Log food',
    display: 'icon-only',
    title: 'Log food',
    isVisible: async (context) => context.filePath === file.path,
    onClick: async (context) => {
      clicks.push(context);
    },
  });
  const context = Object.freeze({ filePath: file.path, placement: 'bottom' });
  assert.equal(await registered.isVisible(context), true);
  await registered.onClick(context);
  assert.deepEqual(clicks, [context]);
  current = false;
  await assert.rejects(registered.isVisible(context), /stale generation/);
  await assert.rejects(registered.onClick(context), /stale generation/);
  assert.doesNotThrow(dispose, 'stale cleanup remains possible');
  assert.equal(disposeCalls, 1);
});

test('opener distinguishes missing and opened files while indeterminate or stale effects reject', async () => {
  const { createTPSGcmIntegrationApi } = await loadPure('../src/tps-gcm-integration-api.ts');
  let current = true;
  let openResult = true;
  const api = createTPSGcmIntegrationApi(createDependencies({
    async openFile() {
      return openResult;
    },
  }), () => {
    if (!current) throw new Error('stale generation');
  });
  assert.deepEqual(await api.openFile({ path: file.path, leafPolicy: 'reuse-current-unless-pinned', reveal: true }), {
    status: 'opened',
  });
  assert.deepEqual(await api.openFile({
    path: 'Health/Missing.md',
    leafPolicy: 'reuse-current-unless-pinned',
    reveal: true,
  }), { status: 'missing-file' });
  openResult = false;
  await assert.rejects(
    api.openFile({ path: file.path, leafPolicy: 'reuse-current-unless-pinned', reveal: true }),
    /could not confirm whether the file-open effect completed/i,
  );
  openResult = true;
  current = false;
  await assert.rejects(
    api.openFile({ path: file.path, leafPolicy: 'reuse-current-unless-pinned', reveal: true }),
    /stale generation/,
  );
});

test('same-session concurrent starts coalesce and only the initiator reports started', async () => {
  const { createTPSGcmIntegrationApi } = await loadPure('../src/tps-gcm-integration-api.ts');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let startCalls = 0;
  let active = [];
  const api = createTPSGcmIntegrationApi(createDependencies({
    async getTimerSessionsById(sessionId) {
      return active.filter((session) => session.id === sessionId);
    },
    async startNoteTimer(_file, _title, sessionId) {
      startCalls += 1;
      await gate;
      const session = noteSession({ id: sessionId });
      active = [session];
      return session;
    },
  }), () => undefined);
  const first = api.startNoteTimer(startRequest);
  const second = api.startNoteTimer(startRequest);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(startCalls, 1);
  release();
  assert.deepEqual(await first, { status: 'started' });
  assert.deepEqual(await second, { status: 'already-running' });
});

test('an exact stop waits for its in-flight start and leaves no owned timer behind', async () => {
  const { createTPSGcmIntegrationApi } = await loadPure('../src/tps-gcm-integration-api.ts');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let active = [];
  let stopCalls = 0;
  const api = createTPSGcmIntegrationApi(createDependencies({
    async getTimerSessionsById(sessionId) {
      return active.filter((session) => session.id === sessionId);
    },
    async startNoteTimer(_file, _title, sessionId) {
      await gate;
      const session = noteSession({ id: sessionId });
      active = [session];
      return session;
    },
    async stopActiveNoteTimerByIdForPath(_path, sessionId, endedAt) {
      stopCalls += 1;
      const session = active.find((candidate) => candidate.id === sessionId) || null;
      active = active.filter((candidate) => candidate.id !== sessionId);
      return session ? { ...session, end: endedAt.toISOString() } : null;
    },
  }), () => undefined);

  const start = api.startNoteTimer(startRequest);
  await new Promise((resolve) => setImmediate(resolve));
  const stop = api.stopNoteTimerForFile(stopRequest);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopCalls, 0, 'stop must remain queued until start settles');
  release();
  assert.deepEqual(await start, { status: 'started' });
  assert.deepEqual(await stop, { status: 'stopped' });
  assert.equal(stopCalls, 1);
  assert.deepEqual(active, []);
});

test('one session identity serializes starts across different paths', async () => {
  const { createTPSGcmIntegrationApi } = await loadPure('../src/tps-gcm-integration-api.ts');
  const otherFile = Object.freeze({ path: 'Health/Workouts/Other.md' });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const sessions = new Map();
  let concurrentStarts = 0;
  let maxConcurrentStarts = 0;
  const api = createTPSGcmIntegrationApi(createDependencies({
    resolveMarkdownFile(path) {
      if (path === file.path) return file;
      if (path === otherFile.path) return otherFile;
      return undefined;
    },
    async getTimerSessionsById(sessionId) {
      return [...sessions.values()].filter((session) => session.id === sessionId);
    },
    async startNoteTimer(targetFile, _title, sessionId) {
      concurrentStarts += 1;
      maxConcurrentStarts = Math.max(maxConcurrentStarts, concurrentStarts);
      try {
        if (targetFile.path === file.path) await gate;
        if (sessions.has(sessionId)) return null;
        const session = noteSession({
          id: sessionId,
          targetPath: targetFile.path,
          sourcePath: targetFile.path,
        });
        sessions.set(sessionId, session);
        return session;
      } finally {
        concurrentStarts -= 1;
      }
    },
  }), () => undefined);

  const first = api.startNoteTimer(startRequest);
  await new Promise((resolve) => setImmediate(resolve));
  const second = api.startNoteTimer({ ...startRequest, path: otherFile.path });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maxConcurrentStarts, 1);
  const secondSettled = assert.rejects(second, /conflicting note-timer session identity/);
  release();
  assert.deepEqual(await first, { status: 'started' });
  await secondSettled;
  assert.equal(sessions.size, 1);
  assert.equal(maxConcurrentStarts, 1);
});

test('one public timer queue serializes different session identities on the same path', async () => {
  const { createTPSGcmIntegrationApi } = await loadPure('../src/tps-gcm-integration-api.ts');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const active = [];
  let concurrentStarts = 0;
  let maxConcurrentStarts = 0;
  const api = createTPSGcmIntegrationApi(createDependencies({
    async getTimerSessionsById(sessionId) {
      return active.filter((session) => session.id === sessionId);
    },
    async startNoteTimer(_targetFile, _title, sessionId) {
      concurrentStarts += 1;
      maxConcurrentStarts = Math.max(maxConcurrentStarts, concurrentStarts);
      try {
        if (sessionId === startRequest.sessionId) await gate;
        const session = noteSession({ id: sessionId });
        active.push(session);
        return session;
      } finally {
        concurrentStarts -= 1;
      }
    },
  }), () => undefined);

  const first = api.startNoteTimer(startRequest);
  await new Promise((resolve) => setImmediate(resolve));
  const second = api.startNoteTimer({ ...startRequest, sessionId: 'gcm-workout-two' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maxConcurrentStarts, 1);
  release();
  assert.deepEqual(await first, { status: 'started' });
  assert.deepEqual(await second, { status: 'started' });
  assert.equal(maxConcurrentStarts, 1);
});

test('start is idempotent by exact session identity and rejects a task or wrong-path result', async () => {
  const { createTPSGcmIntegrationApi } = await loadPure('../src/tps-gcm-integration-api.ts');
  let startCalls = 0;
  const existingApi = createTPSGcmIntegrationApi(createDependencies({
    async getTimerSessionsById() {
      return [noteSession()];
    },
    async startNoteTimer() {
      startCalls += 1;
      return noteSession();
    },
  }), () => undefined);
  assert.deepEqual(await existingApi.startNoteTimer(startRequest), { status: 'already-running' });
  assert.equal(startCalls, 0);

  for (const invalidSession of [
    noteSession({ targetType: 'task' }),
    noteSession({ targetPath: 'Health/Other.md', sourcePath: 'Health/Other.md' }),
    noteSession({ id: 'another-session' }),
  ]) {
    const invalidApi = createTPSGcmIntegrationApi(createDependencies({
      async startNoteTimer() {
        return invalidSession;
      },
    }), () => undefined);
    await assert.rejects(invalidApi.startNoteTimer(startRequest), /requested note-timer target/i);
  }
});

test('stop selects an exact note-session ID and still cleans it after tracking is disabled', async () => {
  const { createTPSGcmIntegrationApi } = await loadPure('../src/tps-gcm-integration-api.ts');
  const manual = noteSession({ id: 'manual-note-timer', start: '2026-07-20T04:00:00.000Z' });
  const task = noteSession({ id: 'task-timer', targetType: 'task', start: '2026-07-20T03:00:00.000Z' });
  const ownedAfterRename = noteSession({ targetPath: 'Health/Workouts/Renamed Strength.md' });
  const calls = [];
  const api = createTPSGcmIntegrationApi(createDependencies({
    isTimeTrackingEnabled() {
      return false;
    },
    async getTimerSessionsById(sessionId) {
      return [task, manual, ownedAfterRename].filter((session) => session.id === sessionId);
    },
    async stopActiveNoteTimerByIdForPath(path, sessionId, endedAt) {
      calls.push({ path, sessionId, endedAt: endedAt.toISOString() });
      return { ...ownedAfterRename, end: endedAt.toISOString() };
    },
  }), () => undefined);
  assert.deepEqual(await api.stopNoteTimerForFile(stopRequest), { status: 'stopped' });
  assert.deepEqual(calls, [{ path: file.path, sessionId: startRequest.sessionId, endedAt: stopRequest.endedAt }]);

  await assert.rejects(api.stopNoteTimerForFile({
    path: stopRequest.path,
    endedAt: stopRequest.endedAt,
  }), /requires an exact session identity/i);
});

test('stop reports incoherent end instants and rejects an unconfirmed exact-session mutation', async () => {
  const { createTPSGcmIntegrationApi } = await loadPure('../src/tps-gcm-integration-api.ts');
  let active = [noteSession()];
  let stopCalls = 0;
  const api = createTPSGcmIntegrationApi(createDependencies({
    async getTimerSessionsById(sessionId) {
      return active.filter((session) => session.id === sessionId);
    },
    async stopActiveNoteTimerByIdForPath() {
      stopCalls += 1;
      return null;
    },
  }), () => undefined);
  assert.deepEqual(await api.stopNoteTimerForFile({
    ...stopRequest,
    endedAt: '2026-07-20T04:59:59.000Z',
  }), { status: 'invalid-end' });
  assert.deepEqual(await api.stopNoteTimerForFile({
    ...stopRequest,
    endedAt: '2026-07-20T06:05:00.001Z',
  }), { status: 'invalid-end' });
  assert.equal(stopCalls, 0);
  await assert.rejects(api.stopNoteTimerForFile(stopRequest), /could not confirm that the requested note timer stopped/i);
  active = [];
  assert.deepEqual(await api.stopNoteTimerForFile(stopRequest), { status: 'not-running' });

  const unconfirmedApi = createTPSGcmIntegrationApi(createDependencies({
    async getTimerSessionsById() {
      return [noteSession()];
    },
    async stopActiveNoteTimerByIdForPath() {
      return noteSession();
    },
  }), () => undefined);
  await assert.rejects(
    unconfirmedApi.stopNoteTimerForFile(stopRequest),
    /could not confirm the stopped note-timer identity/i,
  );
});

test('exact stop rejects a globally active session identity owned by another path', async () => {
  const { createTPSGcmIntegrationApi } = await loadPure('../src/tps-gcm-integration-api.ts');
  const conflicting = noteSession({
    targetPath: 'Health/Workouts/Other.md',
    sourcePath: 'Health/Workouts/Other.md',
  });
  const api = createTPSGcmIntegrationApi(createDependencies({
    async getTimerSessionsById() {
      return [conflicting];
    },
  }), () => undefined);

  await assert.rejects(
    api.stopNoteTimerForFile(stopRequest),
    /could not confirm the active note-timer target/i,
  );
});

test('start snapshots the requested path so a rename during the effect remains exactly cleanable', async () => {
  const { createTPSGcmIntegrationApi } = await loadPure('../src/tps-gcm-integration-api.ts');
  const mutableFile = { path: file.path };
  let sessions = [];
  let capturedRequestedPath = '';
  const api = createTPSGcmIntegrationApi(createDependencies({
    resolveMarkdownFile(path) {
      return path === file.path ? mutableFile : undefined;
    },
    async getTimerSessionsById(sessionId) {
      return sessions.filter((session) => session.id === sessionId);
    },
    async startNoteTimer(targetFile, _title, sessionId, _startedAt, requestedPath) {
      capturedRequestedPath = requestedPath;
      targetFile.path = 'Health/Workouts/Renamed During Start.md';
      const session = noteSession({
        id: sessionId,
        targetPath: targetFile.path,
        sourcePath: requestedPath,
      });
      sessions = [session];
      return session;
    },
    async stopActiveNoteTimerByIdForPath(_path, sessionId) {
      const session = sessions.find((candidate) => candidate.id === sessionId) || null;
      sessions = sessions.map((candidate) => candidate.id === sessionId
        ? { ...candidate, end: stopRequest.endedAt }
        : candidate);
      return session ? { ...session, end: stopRequest.endedAt } : null;
    },
  }), () => undefined);

  assert.deepEqual(await api.startNoteTimer(startRequest), { status: 'started' });
  assert.equal(capturedRequestedPath, startRequest.path);
  assert.equal(sessions[0].sourcePath, startRequest.path);
  assert.deepEqual(await api.stopNoteTimerForFile(stopRequest), { status: 'stopped' });
});
