import { App, TFile, moment, normalizePath, parseYaml } from 'obsidian';
import { parseDateFromFilename, parseStrictDateFromFilename } from './daily-file-date';
import { getDailyNotePathDateCandidate } from './daily-note-creation';
import { readInlineFieldValue } from './task-line-metadata';
import * as logger from '../logger';
import {
  isFilePropertiesCompanionPath,
  isFilePropertiesCompanionRecord,
} from '../services/file-properties-service';

type FileLike = {
  path: string;
  basename: string;
};

type DailyNoteIdentitySource = 'canonical-path' | 'strict-path' | 'frontmatter';

type DailyNoteIdentity = {
  isoDate: string;
  source: DailyNoteIdentitySource;
};

type DailyNoteIdentityAnalysis = {
  identity: DailyNoteIdentity | null;
  conflictingDates: string[];
};

type DailyNoteCandidateIndex = {
  dirty: boolean;
  byDate: Map<string, Array<{ file: TFile; identity: DailyNoteIdentity }>>;
  conflictsByDate: Map<string, number>;
  scanCount: number;
};

type LiveDailyNoteCandidateOverride = {
  file: TFile;
  frontmatter: Record<string, unknown> | null;
};

export type DailyNoteResolution =
  | { status: 'absent'; file: null }
  | { status: 'found'; file: TFile }
  | { status: 'blocked'; file: null; reason: string };

export type DailyNoteReconcileOptions = {
  expectedPath?: string | null;
};

type DailyNoteCandidateResolution =
  | { status: 'absent'; file: null; canonicalPath: string }
  | { status: 'found'; file: TFile; canonicalPath: string; sourcePath: string; identity: DailyNoteIdentity }
  | { status: 'blocked'; file: null; canonicalPath: string; reason: string };

type PendingDailyNoteReconciliation = {
  promise: Promise<DailyNoteResolution>;
  expectedPath: string | null;
};

const pendingDailyNoteReconciliations = new WeakMap<object, Map<string, PendingDailyNoteReconciliation>>();
const dailyNoteCandidateIndexes = new WeakMap<object, Map<string, DailyNoteCandidateIndex>>();
const dirtyDailyNoteCandidatePaths = new WeakMap<object, Map<string, number>>();
const liveDailyNoteCandidateOverrides = new WeakMap<object, Map<string, LiveDailyNoteCandidateOverride>>();
const dailyNoteCandidateMutationGenerations = new WeakMap<object, number>();
type DailyNoteConfigurationOverride = {
  folder: string;
  format: string;
  observedRuntimeFolder: string;
  observedRuntimeFormat: string;
  observedRuntimeTemplate: string;
};

const dailyNoteConfigurationOverrides = new WeakMap<object, DailyNoteConfigurationOverride>();
const dailyNoteConfigurationOverrideSuppressed = new WeakSet<object>();

export function clearDailyNoteConfigurationOverride(app: App): void {
  const appKey = app as object;
  const changed = dailyNoteConfigurationOverrides.delete(appKey);
  if (getCoreDailyNotesOptions(app)) dailyNoteConfigurationOverrideSuppressed.add(appKey);
  else dailyNoteConfigurationOverrideSuppressed.delete(appKey);
  if (changed) invalidateDailyNoteCandidateIndex(app);
}

export function registerDailyNoteConfigurationOverride(app: App, folder: unknown, format: unknown): boolean {
  const appKey = app as object;
  // Suppression only protects a Core runtime that became authoritative after
  // an earlier transient snapshot. If Core is no longer the owner, Periodic
  // Notes or the persisted fallback must be able to publish a new snapshot.
  if (!getCoreDailyNotesOptions(app)) dailyNoteConfigurationOverrideSuppressed.delete(appKey);
  const current = resolveDailyNoteConfigurationOverride(app);
  if (!current && dailyNoteConfigurationOverrideSuppressed.has(appKey)) return false;
  const runtime = getCoreDailyNotesOptions(app);
  const next = {
    folder: normalizeDailyFolder(String(folder || '')),
    format: String(format || '').trim() || 'YYYY-MM-DD',
    observedRuntimeFolder: normalizeDailyFolder(String(runtime?.folder || '')),
    observedRuntimeFormat: String(runtime?.format || '').trim(),
    observedRuntimeTemplate: String(runtime?.template || '').trim(),
  };
  if (
    current
    && current.folder === next.folder
    && current.format === next.format
    && current.observedRuntimeFolder === next.observedRuntimeFolder
    && current.observedRuntimeFormat === next.observedRuntimeFormat
    && current.observedRuntimeTemplate === next.observedRuntimeTemplate
  ) return true;
  dailyNoteConfigurationOverrides.set(app as object, next);
  const indexes = dailyNoteCandidateIndexes.get(appKey);
  if (indexes) {
    for (const index of indexes.values()) index.dirty = true;
  }
  return true;
}

export function hasActiveDailyNoteConfigurationOverride(app: App): boolean {
  return resolveDailyNoteConfigurationOverride(app) !== null;
}

export function dailyNoteTaskScheduleInheritanceEnabled(settings: unknown): boolean {
  return (settings as { inheritUnscheduledTasksFromDailyNotes?: boolean } | null | undefined)
    ?.inheritUnscheduledTasksFromDailyNotes !== false;
}

export function getDailyNoteFolder(app: App): string {
  const override = resolveDailyNoteConfigurationOverride(app);
  if (override) return override.folder;
  try {
    const options = getCoreDailyNotesOptions(app);
    if (options) return String(options.folder || '').trim();
  } catch {
    // Fall through to the historical plugin default.
  }
  return 'System/Dailynotes';
}

export function getDailyNoteDateFormat(app: App, settings: unknown): string {
  const override = resolveDailyNoteConfigurationOverride(app);
  if (override) return override.format;
  const dailyNotesFormat = String(getCoreDailyNotesOptions(app)?.format || '').trim();
  if (dailyNotesFormat) return dailyNotesFormat;
  const configured = String((settings as { dailyNoteDateFormat?: string } | null | undefined)?.dailyNoteDateFormat || '').trim();
  return configured || 'YYYY-MM-DD';
}

function getCoreDailyNotesOptions(app: App): Record<string, unknown> | null {
  const internalPlugins = (app as any).internalPlugins;
  const plugin = internalPlugins?.getPluginById?.('daily-notes')
    ?? internalPlugins?.plugins?.['daily-notes'];
  if (plugin?.enabled === false) return null;
  return plugin?.instance?.options && typeof plugin.instance.options === 'object'
    ? plugin.instance.options
    : null;
}

function resolveDailyNoteConfigurationOverride(app: App): DailyNoteConfigurationOverride | null {
  const appKey = app as object;
  const override = dailyNoteConfigurationOverrides.get(appKey);
  if (!override) return null;
  const runtime = getCoreDailyNotesOptions(app);
  if (runtime) {
    const runtimeFolder = normalizeDailyFolder(String(runtime.folder || ''));
    const runtimeFormat = String(runtime.format || '').trim();
    const runtimeTemplate = String(runtime.template || '').trim();
    if (
      runtimeFolder !== override.observedRuntimeFolder
      || runtimeFormat !== override.observedRuntimeFormat
      || runtimeTemplate !== override.observedRuntimeTemplate
    ) {
      dailyNoteConfigurationOverrides.delete(appKey);
      dailyNoteConfigurationOverrideSuppressed.add(appKey);
      invalidateDailyNoteCandidateIndex(app);
      return null;
    }
  }
  return override;
}

export function parseDailyNoteFileDate(app: App, settings: unknown, file: FileLike): string | null {
  return classifyDailyNoteFile(app, settings, file)?.isoDate ?? null;
}

export function normalizeDailyNoteIsoDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(text)) return null;
  const momentLib = (((globalThis as any).window as any)?.moment || moment) as any;
  const parsed = momentLib(text, 'YYYY-MM-DD', true);
  return parsed?.isValid?.() && parsed.isValid() && parsed.format('YYYY-MM-DD') === text
    ? text
    : null;
}

export function normalizeExpectedDailyNotePath(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return normalizePath(text).replace(/^\/+/, '');
}

export function hasExplicitDailyNoteIdentity(
  frontmatter: Record<string, unknown> | null | undefined,
  settings?: unknown,
): boolean {
  if (!frontmatter || isProcessRunFrontmatter(frontmatter)) return false;

  const configuredKindKey = String(
    (settings as { nativeRecordKindPropertyKey?: string } | null | undefined)?.nativeRecordKindPropertyKey || '',
  ).trim();
  const kindKeys = Array.from(new Set(['kind', 'kinds', configuredKindKey].filter(Boolean)));
  const kindValues = kindKeys.flatMap((key) => normalizeFrontmatterList(getFrontmatterValue(frontmatter, key)));
  if (kindValues.some((value) => isAcceptedDailyNoteMarker(normalizeDailyNoteMarker(value)))) return true;

  const tagValues = ['tags', 'tag']
    .flatMap((key) => normalizeFrontmatterList(getFrontmatterValue(frontmatter, key)));
  if (tagValues.some((value) => {
    const marker = normalizeDailyNoteMarker(value);
    return marker === 'dailynote' || marker === 'typenotedaily';
  })) return true;

  const typeValues = ['type', 'types']
    .flatMap((key) => normalizeFrontmatterList(getFrontmatterValue(frontmatter, key)));
  return typeValues.some((value) => isAcceptedDailyNoteMarker(normalizeDailyNoteMarker(value)));
}

function classifyDailyNoteFile(app: App, settings: unknown, file: FileLike): DailyNoteIdentity | null {
  const override = liveDailyNoteCandidateOverrides.get(app as object)?.get(normalizePath(file.path));
  return analyzeDailyNoteFile(
    app,
    settings,
    file,
    override?.file === file ? override.frontmatter : undefined,
  ).identity;
}

function analyzeDailyNoteFile(
  app: App,
  settings: unknown,
  file: FileLike,
  liveFrontmatter?: Record<string, unknown> | null,
): DailyNoteIdentityAnalysis {
  const frontmatter = liveFrontmatter === undefined
    ? getFileFrontmatter(app, file)
    : liveFrontmatter;
  // Path and MetadataCache guards are insufficient for moved companions or a
  // stale cache. The effective current-byte record marker always vetoes Daily
  // Note identity before canonical/strict-path classification.
  if (frontmatter && isFilePropertiesCompanionRecord(frontmatter)) {
    return { identity: null, conflictingDates: [] };
  }
  // A process/workout identity is authoritative even when the file happens to
  // sit at a date-only path inside the configured Daily Notes folder.
  if (frontmatter && isProcessRunFrontmatter(frontmatter)) return { identity: null, conflictingDates: [] };
  const explicitDailyNoteIdentity = hasExplicitDailyNoteIdentity(frontmatter, settings);
  // An authored record kind is stronger than a stale Daily Note tag/type. A
  // calendar, food, task, or workout record must never be renamed merely
  // because it retained old Daily Note metadata.
  if (frontmatter && hasAuthoritativeNonDailyNoteIdentity(frontmatter, settings)) {
    return { identity: null, conflictingDates: [] };
  }

  const signals: DailyNoteIdentity[] = [];
  const canonicalDate = getCanonicalDailyNotePathDate(app, settings, file.path);
  if (canonicalDate) signals.push({ isoDate: canonicalDate, source: 'canonical-path' });

  const candidate = getDailyNotePathDateCandidate(file.path, getDailyNoteFolder(app));
  const strictDate = candidate
    ? parseStrictDailyNoteDate(candidate, getDailyNoteDateFormat(app, settings))
    : null;
  if (strictDate) signals.push({ isoDate: strictDate, source: 'strict-path' });

  if (explicitDailyNoteIdentity) {
    const basenameDate = parseStrictDailyNoteDate(file.basename, getDailyNoteDateFormat(app, settings));
    if (basenameDate) signals.push({ isoDate: basenameDate, source: 'frontmatter' });

    const scheduled = getFrontmatterValue(frontmatter!, 'scheduled');
    const scheduledDate = getIsoDateFromScheduledValue(String(scheduled ?? ''));
    if (scheduledDate) signals.push({ isoDate: scheduledDate, source: 'frontmatter' });

    const title = getFrontmatterValue(frontmatter!, 'title');
    const titleDate = parseStrictDailyNoteDate(String(title ?? ''), getDailyNoteDateFormat(app, settings));
    if (titleDate) signals.push({ isoDate: titleDate, source: 'frontmatter' });

    // Embedded dates are intentionally available only after an authoritative
    // Daily Note marker. This supports named legacy notes without allowing
    // date-prefixed calendar, food, workout, or task records into the set.
    const embedded = parseDateFromFilename(file.basename, getDailyNoteDateFormat(app, settings));
    if (embedded?.isValid?.() && embedded.isValid()) {
      signals.push({ isoDate: embedded.format('YYYY-MM-DD'), source: 'frontmatter' });
    }
  }

  const dates = Array.from(new Set(signals.map((signal) => signal.isoDate)));
  if (dates.length !== 1) {
    if (dates.length > 1) {
      logger.flowWarn('DailyNoteIdentity', 'classification-conflict', {
        signalCount: signals.length,
        distinctDateCount: dates.length,
      });
    }
    return { identity: null, conflictingDates: dates };
  }
  const identity = signals.find((signal) => signal.source === 'canonical-path')
    || signals.find((signal) => signal.source === 'strict-path')
    || signals[0]
    || null;
  return { identity, conflictingDates: [] };
}

/** Observational lookup retained for public API compatibility. */
export function findExistingDailyNoteForIsoDate(app: App, settings: unknown, isoDate: string): TFile | null {
  const wanted = normalizeDailyNoteIsoDate(isoDate);
  if (!wanted) return null;
  const result = resolveExistingDailyNoteCandidate(app, settings, wanted);
  return result.status === 'found' ? result.file : null;
}

/**
 * Creation/reconciliation path. A unique legacy note is moved through
 * Obsidian's File Manager; ambiguity, collision, or rename failure is distinct
 * from true absence so callers cannot create another duplicate.
 */
export async function reconcileExistingDailyNoteForIsoDate(
  app: App,
  settings: unknown,
  isoDate: string,
  options: DailyNoteReconcileOptions = {},
): Promise<DailyNoteResolution> {
  const wanted = normalizeDailyNoteIsoDate(isoDate);
  if (!wanted) return { status: 'blocked', file: null, reason: 'invalid-iso-date' };
  const hasExpectedPath = options.expectedPath !== undefined && options.expectedPath !== null;
  const expectedPath = hasExpectedPath
    ? normalizeExpectedDailyNotePath(options.expectedPath)
    : null;
  if (hasExpectedPath && !expectedPath) {
    return { status: 'blocked', file: null, reason: 'invalid-expected-path' };
  }

  let byDate = pendingDailyNoteReconciliations.get(app as object);
  if (!byDate) {
    byDate = new Map<string, PendingDailyNoteReconciliation>();
    pendingDailyNoteReconciliations.set(app as object, byDate);
  }
  // Reconciliation ownership is per ISO date. expectedPath constrains the
  // individual caller's result; it must not open a second rename lane.
  const operationKey = wanted;
  const pending = byDate.get(operationKey);
  if (pending) {
    const resolution = await pending.promise;
    if (resolution.status === 'blocked' && expectedPath === null && pending.expectedPath !== null) {
      // The constrained owner has released the per-date gate. Retry this
      // ordinary caller sequentially so it can use the now-authoritative path.
      return reconcileExistingDailyNoteForIsoDate(app, settings, wanted);
    }
    return constrainDailyNoteResolutionToExpectedPath(app, settings, wanted, resolution, expectedPath);
  }

  const work = migrateResolvedDailyNoteCandidate(app, settings, wanted, expectedPath);
  const entry: PendingDailyNoteReconciliation = { promise: work, expectedPath };
  entry.promise = work.finally(() => {
    if (byDate?.get(operationKey) === entry) byDate.delete(operationKey);
  });
  byDate.set(operationKey, entry);
  return constrainDailyNoteResolutionToExpectedPath(app, settings, wanted, await entry.promise, expectedPath);
}

function constrainDailyNoteResolutionToExpectedPath(
  app: App,
  settings: unknown,
  wanted: string,
  resolution: DailyNoteResolution,
  expectedPath: string | null,
): DailyNoteResolution {
  if (expectedPath === null || resolution.status === 'blocked') return resolution;
  const currentPath = getDailyNotePathForIsoDate(app, settings, wanted);
  if (currentPath !== expectedPath) {
    return { status: 'blocked', file: null, reason: 'expected-path-mismatch' };
  }
  if (resolution.status === 'found' && normalizePath(resolution.file.path) !== expectedPath) {
    return { status: 'blocked', file: null, reason: 'expected-path-mismatch' };
  }
  return resolution;
}

function resolveExistingDailyNoteCandidate(
  app: App,
  settings: unknown,
  wanted: string,
): DailyNoteCandidateResolution {
  const canonicalPath = getDailyNotePathForIsoDate(app, settings, wanted);
  if (!canonicalPath) {
    return { status: 'blocked', file: null, canonicalPath: '', reason: 'invalid-iso-date' };
  }
  const canonical = app.vault.getAbstractFileByPath(canonicalPath);
  if (canonical && (!(canonical instanceof TFile) || isManagedFilePropertiesCompanion(app, canonical))) {
    logDailyNoteReconciliationBlocked('target-occupied', wanted, 0);
    return { status: 'blocked', file: null, canonicalPath, reason: 'target-occupied' };
  }

  const indexed = getDailyNoteCandidatesForDate(app, settings, wanted);
  const candidates = indexed.candidates;
  if (indexed.conflictCount > 0) {
    logDailyNoteReconciliationBlocked('conflicting-identity-signals', wanted, indexed.conflictCount);
    return { status: 'blocked', file: null, canonicalPath, reason: 'conflicting-identity-signals' };
  }
  const canonicalIdentity = canonical instanceof TFile
    ? classifyDailyNoteFile(app, settings, canonical)
    : null;
  if (canonical instanceof TFile && canonicalIdentity?.isoDate !== wanted) {
    logDailyNoteReconciliationBlocked('target-not-daily-note', wanted, candidates.length);
    return { status: 'blocked', file: null, canonicalPath, reason: 'target-not-daily-note' };
  }
  if (canonical instanceof TFile) {
    const legacyCandidates = candidates.filter((entry) => normalizePath(entry.file.path) !== normalizePath(canonical.path));
    if (legacyCandidates.length > 0) {
      logDailyNoteReconciliationBlocked('canonical-and-legacy-candidates', wanted, legacyCandidates.length);
      return { status: 'blocked', file: null, canonicalPath, reason: 'canonical-and-legacy-candidates' };
    }
    return {
      status: 'found',
      file: canonical,
      canonicalPath,
      sourcePath: normalizePath(canonical.path),
      identity: canonicalIdentity,
    };
  }

  if (candidates.length !== 1) {
    if (candidates.length === 0) return { status: 'absent', file: null, canonicalPath };
    logDailyNoteReconciliationBlocked('ambiguous-legacy-candidates', wanted, candidates.length);
    return { status: 'blocked', file: null, canonicalPath, reason: 'ambiguous-legacy-candidates' };
  }

  const candidate = candidates[0];
  return {
    status: 'found',
    file: candidate.file,
    canonicalPath,
    sourcePath: normalizePath(candidate.file.path),
    identity: candidate.identity,
  };
}

function getDailyNoteCandidatesForDate(
  app: App,
  settings: unknown,
  isoDate: string,
): { candidates: Array<{ file: TFile; identity: DailyNoteIdentity }>; conflictCount: number } {
  const signature = [
    normalizeDailyFolder(getDailyNoteFolder(app)),
    getDailyNoteDateFormat(app, settings),
    String((settings as { nativeRecordKindPropertyKey?: string } | null | undefined)?.nativeRecordKindPropertyKey || '').trim().toLowerCase(),
  ].join('\u0000');
  let indexes = dailyNoteCandidateIndexes.get(app as object);
  if (!indexes) {
    indexes = new Map();
    dailyNoteCandidateIndexes.set(app as object, indexes);
  }
  let index = indexes.get(signature);
  if (!index) {
    if (indexes.size >= 4) indexes.delete(indexes.keys().next().value as string);
    index = { dirty: true, byDate: new Map(), conflictsByDate: new Map(), scanCount: 0 };
    indexes.set(signature, index);
  }
  if (index.dirty) {
    const byDate = new Map<string, Array<{ file: TFile; identity: DailyNoteIdentity }>>();
    const conflictsByDate = new Map<string, number>();
    const liveOverrides = liveDailyNoteCandidateOverrides.get(app as object);
    for (const file of app.vault.getMarkdownFiles()) {
      if (isManagedFilePropertiesCompanion(app, file)) continue;
      const override = liveOverrides?.get(normalizePath(file.path));
      const analysis = override?.file === file
        ? analyzeDailyNoteFile(app, settings, file, override.frontmatter)
        : analyzeDailyNoteFile(app, settings, file);
      for (const date of analysis.conflictingDates) {
        conflictsByDate.set(date, (conflictsByDate.get(date) || 0) + 1);
      }
      const identity = analysis.identity;
      if (!identity) continue;
      const entries = byDate.get(identity.isoDate) || [];
      entries.push({ file, identity });
      byDate.set(identity.isoDate, entries);
    }
    for (const entries of byDate.values()) {
      entries.sort((a, b) => normalizePath(a.file.path).localeCompare(normalizePath(b.file.path)));
    }
    index.byDate = byDate;
    index.conflictsByDate = conflictsByDate;
    index.scanCount += 1;
    index.dirty = false;
  }
  return {
    candidates: [...(index.byDate.get(isoDate) || [])],
    conflictCount: index.conflictsByDate.get(isoDate) || 0,
  };
}

async function migrateResolvedDailyNoteCandidate(
  app: App,
  settings: unknown,
  wanted: string,
  expectedPath: string | null,
): Promise<DailyNoteResolution> {
  const metadataState = await waitForDailyNoteMetadataCache(app);
  if (metadataState === 'blocked') {
    logDailyNoteReconciliationBlocked('metadata-unresolved', wanted, 0);
    return { status: 'blocked', file: null, reason: 'metadata-unresolved' };
  }
  // A prior observational lookup may have populated the index before the
  // metadata cache finished. Rebuild at the mutation boundary after proving
  // that every Markdown file now has authoritative cache state.
  if (metadataState === 'refreshed') invalidateDailyNoteCandidateIndex(app);
  const liveRefresh = await refreshDirtyDailyNoteCandidatePaths(app, settings);
  if (liveRefresh === 'blocked') {
    logDailyNoteReconciliationBlocked('dirty-source-unresolved', wanted, 0);
    return { status: 'blocked', file: null, reason: 'dirty-source-unresolved' };
  }
  const candidate = resolveExistingDailyNoteCandidate(app, settings, wanted);
  if (expectedPath !== null && normalizePath(candidate.canonicalPath) !== expectedPath) {
    logDailyNoteReconciliationBlocked('expected-path-mismatch', wanted, 0);
    return { status: 'blocked', file: null, reason: 'expected-path-mismatch' };
  }
  if (candidate.status === 'absent') return { status: 'absent', file: null };
  if (candidate.status === 'blocked') {
    return { status: 'blocked', file: null, reason: candidate.reason };
  }
  if (candidate.sourcePath === normalizePath(candidate.canonicalPath)) {
    const liveIdentityBlock = await getLiveDailyNoteCandidateBlockReason(
      app,
      settings,
      candidate.file,
      wanted,
    );
    if (liveIdentityBlock) {
      logDailyNoteReconciliationBlocked(liveIdentityBlock, wanted, 1);
      return { status: 'blocked', file: null, reason: liveIdentityBlock };
    }
    return { status: 'found', file: candidate.file };
  }

  const canonicalPath = candidate.canonicalPath;
  if (!(await ensureDailyNoteTargetFolder(app, canonicalPath))) {
    logDailyNoteReconciliationBlocked('target-folder-unavailable', wanted, 1);
    return { status: 'blocked', file: null, reason: 'target-folder-unavailable' };
  }

  const occupiedBeforeRename = app.vault.getAbstractFileByPath(canonicalPath);
  if (occupiedBeforeRename) {
    logDailyNoteReconciliationBlocked('target-occupied-race', wanted, 1);
    return { status: 'blocked', file: null, reason: 'target-occupied-race' };
  }
  const currentCanonicalPath = getDailyNotePathForIsoDate(app, settings, wanted);
  if (
    currentCanonicalPath !== canonicalPath
    || (expectedPath !== null && currentCanonicalPath !== expectedPath)
  ) {
    logDailyNoteReconciliationBlocked('expected-path-changed-before-rename', wanted, 1);
    return { status: 'blocked', file: null, reason: 'expected-path-changed-before-rename' };
  }
  const liveCandidate = app.vault.getAbstractFileByPath(candidate.sourcePath);
  if (
    normalizePath(candidate.file.path) !== candidate.sourcePath
    || !(liveCandidate instanceof TFile)
    || liveCandidate !== candidate.file
  ) {
    logDailyNoteReconciliationBlocked('legacy-source-changed', wanted, 1);
    return { status: 'blocked', file: null, reason: 'legacy-source-changed' };
  }

  const liveIdentityBlock = await getLiveDailyNoteCandidateBlockReason(
    app,
    settings,
    candidate.file,
    wanted,
  );
  if (liveIdentityBlock) {
    logDailyNoteReconciliationBlocked(liveIdentityBlock, wanted, 1);
    return { status: 'blocked', file: null, reason: liveIdentityBlock };
  }

  // Reading current bytes yields to Sync and other plugins. Recheck every
  // path/configuration guard immediately before the File Manager mutation.
  const liveCandidateAfterRead = app.vault.getAbstractFileByPath(candidate.sourcePath);
  if (
    normalizePath(candidate.file.path) !== candidate.sourcePath
    || !(liveCandidateAfterRead instanceof TFile)
    || liveCandidateAfterRead !== candidate.file
  ) {
    logDailyNoteReconciliationBlocked('legacy-source-changed', wanted, 1);
    return { status: 'blocked', file: null, reason: 'legacy-source-changed' };
  }
  if (app.vault.getAbstractFileByPath(canonicalPath)) {
    logDailyNoteReconciliationBlocked('target-occupied-race', wanted, 1);
    return { status: 'blocked', file: null, reason: 'target-occupied-race' };
  }
  const canonicalPathAfterRead = getDailyNotePathForIsoDate(app, settings, wanted);
  if (
    canonicalPathAfterRead !== canonicalPath
    || (expectedPath !== null && canonicalPathAfterRead !== expectedPath)
  ) {
    logDailyNoteReconciliationBlocked('expected-path-changed-before-rename', wanted, 1);
    return { status: 'blocked', file: null, reason: 'expected-path-changed-before-rename' };
  }

  try {
    const renameFile = (app as any)?.fileManager?.renameFile;
    if (typeof renameFile !== 'function') {
      logDailyNoteReconciliationBlocked('file-manager-unavailable', wanted, 1);
      return { status: 'blocked', file: null, reason: 'file-manager-unavailable' };
    }
    await renameFile.call((app as any).fileManager, candidate.file, canonicalPath);
    const renamed = app.vault.getAbstractFileByPath(canonicalPath);
    if (!(renamed instanceof TFile) || isManagedFilePropertiesCompanion(app, renamed)) {
      logDailyNoteReconciliationBlocked('rename-unconfirmed', wanted, 1);
      return { status: 'blocked', file: null, reason: 'rename-unconfirmed' };
    }
    logger.flow('DailyNoteIdentity', 'legacy-reconciled', {
      date: wanted,
      source: candidate.identity?.source || 'strict-path',
    });
    return { status: 'found', file: renamed };
  } catch (error) {
    logger.flowWarn('DailyNoteIdentity', 'legacy-reconcile-blocked', {
      reason: 'rename-failed',
      date: wanted,
      candidateCount: 1,
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return { status: 'blocked', file: null, reason: 'rename-failed' };
  }
}

type RawFrontmatterInspection =
  | { status: 'absent'; frontmatter: null }
  | { status: 'valid'; frontmatter: Record<string, unknown> }
  | { status: 'invalid'; frontmatter: null };

async function getLiveDailyNoteCandidateBlockReason(
  app: App,
  settings: unknown,
  file: TFile,
  wanted: string,
): Promise<string | null> {
  let current = '';
  try {
    current = await app.vault.read(file);
  } catch {
    return 'source-unreadable';
  }

  const inspected = inspectRawFrontmatter(current);
  if (inspected.status === 'invalid') return 'source-frontmatter-unparseable';
  const liveAnalysis = analyzeDailyNoteFile(app, settings, file, inspected.frontmatter);
  if (liveAnalysis.conflictingDates.length > 0) return 'source-identity-conflict';
  return liveAnalysis.identity?.isoDate === wanted
    ? null
    : 'source-identity-changed';
}

function inspectRawFrontmatter(raw: string): RawFrontmatterInspection {
  const source = String(raw || '').replace(/\r\n/g, '\n');
  const normalized = source.startsWith('\uFEFF') ? source.slice(1) : source;
  if (!normalized.startsWith('---\n')) {
    return normalized.trimStart().startsWith('---')
      ? { status: 'invalid', frontmatter: null }
      : { status: 'absent', frontmatter: null };
  }

  const closingMarker = normalized.indexOf('\n---\n', 4);
  const closingMarkerAtEnd = normalized.endsWith('\n---') ? normalized.length - 4 : -1;
  const closingIndex = closingMarker >= 0 ? closingMarker : closingMarkerAtEnd;
  if (closingIndex < 0) return { status: 'invalid', frontmatter: null };

  try {
    const parsed = parseYaml(normalized.slice(4, closingIndex));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'invalid', frontmatter: null };
    }
    return { status: 'valid', frontmatter: parsed as Record<string, unknown> };
  } catch {
    return { status: 'invalid', frontmatter: null };
  }
}

function getCanonicalDailyNotePathDate(app: App, settings: unknown, filePath: string): string | null {
  const candidate = getDailyNotePathDateCandidate(filePath, getDailyNoteFolder(app));
  if (!candidate) return null;
  const parsed = parseStrictDateFromFilename(candidate, getDailyNoteDateFormat(app, settings));
  if (!parsed?.isValid?.() || !parsed.isValid()) return null;
  const isoDate = parsed.format('YYYY-MM-DD');
  const canonicalPath = getDailyNotePathForIsoDate(app, settings, isoDate);
  return canonicalPath && normalizePath(filePath) === canonicalPath
    ? isoDate
    : null;
}

function parseStrictDailyNoteDate(value: string, format: string): string | null {
  const parsed = parseStrictDateFromFilename(String(value || '').trim(), format);
  return parsed?.isValid?.() && parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}

function getFileFrontmatter(app: App, file: FileLike): Record<string, unknown> | null {
  try {
    const cache = (app as any)?.metadataCache?.getFileCache?.(file as TFile);
    return cache?.frontmatter && typeof cache.frontmatter === 'object'
      ? cache.frontmatter as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function getFrontmatterValue(frontmatter: Record<string, unknown>, key: string): unknown {
  const normalized = String(key || '').trim().toLowerCase();
  if (!normalized) return undefined;
  const actual = Object.keys(frontmatter).find((candidate) => candidate.trim().toLowerCase() === normalized);
  return actual ? frontmatter[actual] : undefined;
}

function normalizeFrontmatterList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
  return source
    .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
    .map((entry) => String(entry ?? '').replace(/^#/, '').trim())
    .filter(Boolean);
}

export function hasAuthoritativeNonDailyNoteIdentity(
  frontmatter: Record<string, unknown>,
  settings: unknown,
): boolean {
  if (isProcessRunFrontmatter(frontmatter)) return true;
  const configuredKindKey = String(
    (settings as { nativeRecordKindPropertyKey?: string } | null | undefined)?.nativeRecordKindPropertyKey || '',
  ).trim();
  const authoredKindKeys = Array.from(new Set(['kind', 'kinds', configuredKindKey].filter(Boolean)));
  const authoredKindMarkers = authoredKindKeys
    .flatMap((key) => normalizeFrontmatterList(getFrontmatterValue(frontmatter, key)))
    .map(normalizeDailyNoteMarker);
  // `kind`, `kinds`, and the configured native kind key are record identity,
  // not an extensible allowlist. Every nonblank value must be a recognized
  // Daily alias; mixed Daily/non-Daily values therefore fail closed.
  if (authoredKindMarkers.some((marker) => !isAcceptedDailyNoteMarker(marker))) return true;

  // `type`/`types` predate the native record contract and remain a deliberate
  // compatibility surface: accepted Daily aliases opt in, while only known
  // TPS record types veto path-derived Daily identity.
  const typeMarkers = ['type', 'types']
    .flatMap((key) => normalizeFrontmatterList(getFrontmatterValue(frontmatter, key)))
    .map(normalizeDailyNoteMarker);
  const nonDailyKinds = new Set([
    'activityentry',
    'area',
    'asset',
    'calendarevent',
    'exercise',
    'food',
    'foodentry',
    'project',
    'recipe',
    'task',
    'workoutexercise',
    'workoutsession',
  ]);
  return typeMarkers.some((marker) => nonDailyKinds.has(marker));
}

function isAcceptedDailyNoteMarker(marker: string): boolean {
  return marker === 'daily'
    || marker === 'dailynote'
    || marker === 'notedaily'
    || marker === 'typenotedaily';
}

function normalizeDailyNoteMarker(value: unknown): string {
  return String(value ?? '')
    .replace(/^#/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_/-]+/g, '');
}

function isProcessRunFrontmatter(frontmatter: Record<string, unknown>): boolean {
  const value = (key: string) => String(getFrontmatterValue(frontmatter, key) ?? '').trim().toLowerCase();
  const kindMarkers = normalizeFrontmatterList(getFrontmatterValue(frontmatter, 'kind')).map(normalizeDailyNoteMarker);
  return value('runKind') === 'run'
    || value('workflowKind') === 'workflow'
    || kindMarkers.some((kind) => [
      'workout',
      'workoutplan',
      'workoutsession',
      'workoutexercise',
    ].includes(kind))
    || Boolean(value('runType'))
    || Boolean(value('workflowType'));
}

async function ensureDailyNoteTargetFolder(app: App, targetPath: string): Promise<boolean> {
  const normalized = normalizePath(targetPath);
  const slash = normalized.lastIndexOf('/');
  if (slash < 0) return true;
  const folderPath = normalized.slice(0, slash);
  if (!folderPath) return true;
  let current = '';
  for (const segment of folderPath.split('/').filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing instanceof TFile) return false;
    if (existing) continue;
    try {
      await app.vault.createFolder(current);
    } catch {
      if (!app.vault.getAbstractFileByPath(current)) return false;
    }
  }
  return true;
}

async function waitForDailyNoteMetadataCache(app: App): Promise<'ready' | 'refreshed' | 'blocked'> {
  const metadataCache = (app as any)?.metadataCache;
  if (!metadataCache?.getFileCache || !app.vault?.getMarkdownFiles) return 'ready';
  const deadline = Date.now() + 5_000;
  const waitedForInitialization = metadataCache.initialized === false;
  while (metadataCache.initialized === false && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  if (metadataCache.initialized === false) return 'blocked';

  let unresolved = app.vault.getMarkdownFiles().filter((file) => metadataCache.getFileCache(file) == null);
  if (unresolved.length === 0) return waitedForInitialization ? 'refreshed' : 'ready';

  while (unresolved.length > 0 && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    unresolved = unresolved.filter((file) => {
      const live = app.vault.getAbstractFileByPath(file.path);
      return live instanceof TFile && metadataCache.getFileCache(live) == null;
    });
  }
  return unresolved.length === 0 ? 'refreshed' : 'blocked';
}

export function invalidateDailyNoteCandidateIndex(app: App): void {
  const indexes = dailyNoteCandidateIndexes.get(app as object);
  if (!indexes) return;
  for (const index of indexes.values()) index.dirty = true;
}

/** Sync API identity reads must stay fail-closed until current bytes have won. */
export function hasPendingDailyNoteCandidatePathRefresh(app: App): boolean {
  return (dirtyDailyNoteCandidatePaths.get(app as object)?.size || 0) > 0;
}

/**
 * Vault Markdown events precede MetadataCache's matching generation. Record
 * only the changed path so mutation-time absence checks can inspect current
 * bytes without reading every Markdown source in the vault.
 */
export function markDailyNoteCandidatePathDirty(app: App, fileOrPath: FileLike | string): void {
  const path = normalizePath(typeof fileOrPath === 'string' ? fileOrPath : fileOrPath?.path);
  if (!path || !path.toLowerCase().endsWith('.md')) return;
  const appKey = app as object;
  let dirty = dirtyDailyNoteCandidatePaths.get(appKey);
  if (!dirty) {
    dirty = new Map<string, number>();
    dirtyDailyNoteCandidatePaths.set(appKey, dirty);
  }
  const generation = (dailyNoteCandidateMutationGenerations.get(appKey) || 0) + 1;
  dailyNoteCandidateMutationGenerations.set(appKey, generation);
  dirty.set(path, generation);
  liveDailyNoteCandidateOverrides.get(appKey)?.delete(path);
  invalidateDailyNoteCandidateIndex(app);
}

/**
 * Observe a MetadataCache ready event without treating it as proof of which
 * vault-write generation it represents. Obsidian does not correlate cache
 * events with vault events, so a delayed event for generation N must never
 * erase a pending generation N+1 or the last current-byte override. The
 * mutation-time live refresh is the only owner allowed to clear dirty paths;
 * the next vault mutation supersedes an override explicitly.
 */
export function markDailyNoteCandidateMetadataReady(
  app: App,
  fileOrPath?: FileLike | string | null,
): void {
  if (fileOrPath != null) {
    const path = normalizePath(typeof fileOrPath === 'string' ? fileOrPath : fileOrPath?.path);
    if (!path) return;
  }
  invalidateDailyNoteCandidateIndex(app);
}

async function refreshDirtyDailyNoteCandidatePaths(
  app: App,
  settings: unknown,
): Promise<'ready' | 'blocked'> {
  const appKey = app as object;
  const dirty = dirtyDailyNoteCandidatePaths.get(appKey);
  if (!dirty || dirty.size === 0) return 'ready';
  let overrides = liveDailyNoteCandidateOverrides.get(appKey);
  if (!overrides) {
    overrides = new Map<string, LiveDailyNoteCandidateOverride>();
    liveDailyNoteCandidateOverrides.set(appKey, overrides);
  }

  let changed = false;
  const deadline = Date.now() + 5_000;
  while (dirty.size > 0 && Date.now() < deadline) {
    const next = dirty.entries().next().value as [string, number] | undefined;
    if (!next) break;
    const [path, generation] = next;
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') {
      if (dirty.get(path) === generation) {
        dirty.delete(path);
        overrides.delete(path);
      }
      changed = true;
      continue;
    }
    let current = '';
    try {
      current = await app.vault.read(file);
    } catch {
      return 'blocked';
    }
    if (dirty.get(path) !== generation) {
      // A later modify/rename event superseded this read. Leave its newer
      // generation queued; never commit or clear bytes from the older read.
      continue;
    }
    const inspected = inspectRawFrontmatter(current);
    if (inspected.status === 'invalid') return 'blocked';
    overrides.set(path, {
      file,
      frontmatter: inspected.frontmatter,
    });
    dirty.delete(path);
    changed = true;
  }
  if (dirty.size > 0) return 'blocked';
  if (changed) invalidateDailyNoteCandidateIndex(app);
  return 'ready';
}

/**
 * Drain pending vault generations from current bytes in the background. This
 * uses the same generation CAS as mutation-time reconciliation, so an older
 * metadata notification can trigger recovery without ever clearing a newer
 * write. The live override remains authoritative until the next vault event.
 */
export async function refreshPendingDailyNoteCandidatePaths(
  app: App,
  settings: unknown,
): Promise<boolean> {
  return (await refreshDirtyDailyNoteCandidatePaths(app, settings)) === 'ready';
}

function logDailyNoteReconciliationBlocked(reason: string, isoDate: string, candidateCount: number): void {
  logger.flowWarn('DailyNoteIdentity', 'legacy-reconcile-blocked', {
    reason,
    date: isoDate,
    candidateCount,
  });
}

function isManagedFilePropertiesCompanion(app: App, file: TFile): boolean {
  return isFilePropertiesCompanionPath(file.path)
    || isFilePropertiesCompanionRecord(app.metadataCache.getFileCache(file)?.frontmatter);
}

export function getDailyNoteScheduledValueForIsoDate(isoDate: string): string {
  return `${String(isoDate || '').trim()} 00:00:00`;
}

export function getInheritedDailyNoteTaskScheduledValue(app: App, settings: unknown, file: FileLike): string | null {
  if (!dailyNoteTaskScheduleInheritanceEnabled(settings)) return null;
  return parseDailyNoteFileDate(app, settings, file);
}

export function resolveTaskScheduledValue(app: App, settings: unknown, file: FileLike, rawLine: string): string {
  const explicit = readInlineFieldValue(rawLine, 'scheduled')
    || readInlineFieldValue(rawLine, 'start')
    || readInlineFieldValue(rawLine, 'date');
  if (explicit) return explicit;
  return getInheritedDailyNoteTaskScheduledValue(app, settings, file) || '';
}

export function getIsoDateFromScheduledValue(value: string): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const momentLib = (((globalThis as any).window as any)?.moment || moment) as any;
  const parsed = momentLib(text, [
    momentLib.ISO_8601,
    'YYYY-MM-DD',
    'YYYY-MM-DD HH:mm',
    'YYYY-MM-DD HH:mm:ss',
    'YYYY-MM-DDTHH:mm',
    'YYYY-MM-DDTHH:mm:ss',
  ], true);
  if (parsed?.isValid?.() && parsed.isValid()) return parsed.format('YYYY-MM-DD');
  const fallback = momentLib(text);
  return fallback?.isValid?.() && fallback.isValid() ? fallback.format('YYYY-MM-DD') : null;
}

export function getDailyNotePathForIsoDate(app: App, settings: unknown, isoDate: string): string | null {
  const normalizedIsoDate = normalizeDailyNoteIsoDate(isoDate);
  if (!normalizedIsoDate) return null;
  const momentLib = (((globalThis as any).window as any)?.moment || moment) as any;
  const parsed = momentLib(normalizedIsoDate, 'YYYY-MM-DD', true);
  if (!parsed?.isValid?.() || !parsed.isValid()) return null;
  const basename = parsed.format(getDailyNoteDateFormat(app, settings));
  const folder = normalizeDailyFolder(getDailyNoteFolder(app));
  return normalizePath(folder ? `${folder}/${basename}.md` : `${basename}.md`);
}

export function normalizeDailyFolder(folder: string): string {
  const normalized = normalizePath(String(folder || '').trim());
  return normalized === '/' ? '' : normalized.replace(/^\/+|\/+$/g, '');
}
