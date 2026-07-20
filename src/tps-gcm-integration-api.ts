import type {
  TPSGcmExternalActionRegistration,
  TPSGcmIntegrationApi,
  TPSGcmStartNoteTimerResult,
  TPSGcmStopNoteTimerRequest,
  TPSGcmStopNoteTimerResult,
} from './tps-gcm-integration-contract';
import { TPS_GCM_TIMER_END_FUTURE_SKEW_MS } from './tps-gcm-integration-contract';

export interface TPSGcmIntegrationFile {
  readonly path: string;
}

export interface TPSGcmIntegrationTimerSession {
  readonly id: string;
  readonly targetType: string;
  readonly targetPath?: string;
  readonly sourcePath?: string;
  readonly start: string;
  readonly end?: string;
}

export interface TPSGcmIntegrationApiDependencies<File extends TPSGcmIntegrationFile> {
  registerExternalAction(action: Readonly<TPSGcmExternalActionRegistration>): () => void;
  resolveMarkdownFile(path: string): File | undefined;
  openFile(file: File, reveal: true): Promise<boolean>;
  isTimeTrackingEnabled(): boolean;
  getTimerSessionsById(sessionId: string): Promise<readonly TPSGcmIntegrationTimerSession[]>;
  startNoteTimer(
    file: File,
    title: string,
    sessionId: string,
    startedAt: Date,
    requestedPath: string,
  ): Promise<TPSGcmIntegrationTimerSession | null>;
  stopActiveNoteTimerByIdForPath(
    path: string,
    sessionId: string,
    endedAt: Date,
  ): Promise<TPSGcmIntegrationTimerSession | null>;
  now?(): number;
}

function timerSessionMatchesPath(
  session: TPSGcmIntegrationTimerSession,
  expectedPath: string,
): boolean {
  return session.targetPath === expectedPath || session.sourcePath === expectedPath;
}

export function createGcmExternalActionRegistrationKey(pluginId: string, actionId: string): string {
  return JSON.stringify([pluginId, actionId]);
}

/**
 * Creates the real bounded GCM adapter against explicit dependencies.
 * The factory is Obsidian-free so effect, concurrency, and ambiguity rules are behavior-testable.
 */
export function createTPSGcmIntegrationApi<File extends TPSGcmIntegrationFile>(
  dependencies: TPSGcmIntegrationApiDependencies<File>,
  assertCurrent: () => void,
): TPSGcmIntegrationApi {
  let timerOperationTail: Promise<void> = Promise.resolve();

  const runTimerOperation = <Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    const result = timerOperationTail.catch(() => undefined).then(operation);
    timerOperationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const performStart = async (
    file: File,
    title: string,
    sessionId: string,
    startedAtInput: string,
  ): Promise<TPSGcmStartNoteTimerResult> => {
    assertCurrent();
    const startedAt = new Date(startedAtInput);
    const startedAtMillis = startedAt.getTime();
    const now = dependencies.now?.() ?? Date.now();
    if (!Number.isFinite(startedAtMillis)
      || startedAtMillis > now + TPS_GCM_TIMER_END_FUTURE_SKEW_MS) {
      throw new RangeError('GCM note-timer start requires a coherent canonical instant.');
    }
    const requestedPath = file.path;
    const prior = await dependencies.getTimerSessionsById(sessionId);
    assertCurrent();
    if (prior.length > 0) {
      const existing = prior.length === 1 ? prior[0] : undefined;
      if (!existing
        || existing.targetType !== 'note'
        || !timerSessionMatchesPath(existing, requestedPath)) {
        throw new Error('GCM found a conflicting note-timer session identity.');
      }
      if (existing.end) throw new Error('GCM found a completed timer using the requested session identity.');
      return { status: 'already-running' };
    }

    const session = await dependencies.startNoteTimer(file, title, sessionId, startedAt, requestedPath);
    assertCurrent();
    if (!session) return { status: 'declined' };
    if (session.id !== sessionId
      || session.targetType !== 'note'
      || !timerSessionMatchesPath(session, requestedPath)) {
      throw new Error('GCM could not confirm the requested note-timer target.');
    }
    return { status: 'started' };
  };

  const performStop = async (
    request: Readonly<TPSGcmStopNoteTimerRequest>,
  ): Promise<TPSGcmStopNoteTimerResult> => {
    assertCurrent();
    const sessions = await dependencies.getTimerSessionsById(request.sessionId);
    assertCurrent();
    if (sessions.length === 0) return { status: 'not-running' };
    if (sessions.length !== 1) {
      throw new Error('GCM found multiple matching note-timer sessions.');
    }

    const selected = sessions[0];
    if (selected.targetType !== 'note' || !timerSessionMatchesPath(selected, request.path)) {
      throw new Error('GCM could not confirm the active note-timer target.');
    }
    if (selected.end) return { status: 'not-running' };
    const startedAt = new Date(selected.start).getTime();
    const endedAt = new Date(request.endedAt);
    const endedAtMillis = endedAt.getTime();
    const now = dependencies.now?.() ?? Date.now();
    if (!Number.isFinite(startedAt)
      || !Number.isFinite(endedAtMillis)
      || endedAtMillis <= startedAt
      || endedAtMillis > now + TPS_GCM_TIMER_END_FUTURE_SKEW_MS) {
      return { status: 'invalid-end' };
    }

    const stopped = await dependencies.stopActiveNoteTimerByIdForPath(request.path, selected.id, endedAt);
    assertCurrent();
    if (stopped) {
      if (stopped.id !== selected.id
        || stopped.targetType !== 'note'
        || !timerSessionMatchesPath(stopped, request.path)
        || !stopped.end
        || !Number.isFinite(new Date(stopped.end).getTime())) {
        throw new Error('GCM could not confirm the stopped note-timer identity.');
      }
      return { status: 'stopped' };
    }

    const remaining = await dependencies.getTimerSessionsById(selected.id);
    assertCurrent();
    if (remaining.some((candidate) => candidate.id === selected.id && !candidate.end)) {
      throw new Error('GCM could not confirm that the requested note timer stopped.');
    }
    return { status: 'not-running' };
  };

  return {
    apiVersion: 1,
    registerExternalAction: (action) => {
      assertCurrent();
      const unregister = dependencies.registerExternalAction({
        ...action,
        isVisible: action.isVisible
          ? async (context) => {
            assertCurrent();
            const visible = await action.isVisible?.(context);
            assertCurrent();
            return visible === true;
          }
          : undefined,
        onClick: async (context) => {
          assertCurrent();
          await action.onClick(context);
          assertCurrent();
        },
      });
      try {
        assertCurrent();
      } catch (error) {
        unregister();
        throw error;
      }
      return unregister;
    },
    openFile: async (request) => {
      assertCurrent();
      const file = dependencies.resolveMarkdownFile(request.path);
      if (!file) return { status: 'missing-file' };
      assertCurrent();
      const opened = await dependencies.openFile(file, request.reveal);
      assertCurrent();
      if (!opened) {
        throw new Error('GCM could not confirm whether the file-open effect completed.');
      }
      return { status: 'opened' };
    },
    startNoteTimer: (request) => runTimerOperation(async () => {
        assertCurrent();
        const file = dependencies.resolveMarkdownFile(request.path);
        if (!file) return { status: 'missing-file' };
        if (!dependencies.isTimeTrackingEnabled()) return { status: 'disabled' };
        return performStart(file, request.title, request.sessionId, request.startedAt);
      }),
    stopNoteTimerForFile: (request) => runTimerOperation(() => {
      if (!request.sessionId) {
        throw new TypeError('GCM note-timer cleanup requires an exact session identity.');
      }
      return performStop(request);
    }),
  };
}
