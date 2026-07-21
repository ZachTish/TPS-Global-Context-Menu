export type SettingsRecord = Record<string, unknown>;

type PendingSettingsWrite = {
  snapshot: SettingsRecord;
  changedKeys: Set<string>;
};

const cloneSettings = (value: SettingsRecord): SettingsRecord =>
  JSON.parse(JSON.stringify(value ?? {})) as SettingsRecord;

const valuesMatch = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const getChangedSettingsKeys = (
  baseline: SettingsRecord,
  snapshot: SettingsRecord,
): Set<string> => {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(snapshot)]);
  return new Set([...keys].filter((key) => !valuesMatch(baseline[key], snapshot[key])));
};

export const mergeChangedSettings = (
  latest: SettingsRecord,
  snapshot: SettingsRecord,
  changedKeys: ReadonlySet<string>,
): SettingsRecord => {
  const merged = cloneSettings(latest);
  for (const key of changedKeys) {
    if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
      merged[key] = cloneSettings({ value: snapshot[key] }).value;
    } else {
      delete merged[key];
    }
  }
  return merged;
};

/**
 * Serializes plugin data writes and merges only locally changed top-level keys
 * into the newest persisted payload. This keeps runtime-only state updates from
 * restoring stale user preferences after iCloud/Obsidian Sync changes data.json.
 */
export class SettingsPersistenceCoordinator {
  private baseline: SettingsRecord = {};
  private pending: PendingSettingsWrite | null = null;
  private active: PendingSettingsWrite | null = null;
  private drainPromise: Promise<void> | null = null;

  constructor(
    private readonly loadLatest: () => Promise<SettingsRecord | null>,
    private readonly saveMerged: (settings: SettingsRecord) => Promise<void>,
    private readonly onPersisted?: (
      requestedSnapshot: SettingsRecord,
      persistedSnapshot: SettingsRecord,
    ) => void,
  ) {}

  setBaseline(settings: SettingsRecord): void {
    this.baseline = cloneSettings(settings);
  }

  request(settings: SettingsRecord): Promise<void> {
    const snapshot = cloneSettings(settings);
    const priorDesired = this.pending ?? this.active;
    const changedKeys = getChangedSettingsKeys(this.baseline, snapshot);
    if (priorDesired) {
      for (const key of priorDesired.changedKeys) changedKeys.add(key);
      for (const key of getChangedSettingsKeys(priorDesired.snapshot, snapshot)) changedKeys.add(key);
    }
    this.pending = {
      snapshot,
      changedKeys,
    };

    if (!this.drainPromise) this.startDrain();
    return this.drainPromise;
  }

  waitForIdle(): Promise<void> {
    return this.drainPromise ?? Promise.resolve();
  }

  private startDrain(): void {
    // Defer entry so the promise is installed before drain() can finish a
    // no-op request. drain() clears the field synchronously before settling,
    // leaving no completion window where a new request can be stranded.
    this.drainPromise = Promise.resolve().then(() => this.drain());
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const requested = this.pending;
        this.pending = null;
        if (requested.changedKeys.size === 0) continue;
        this.active = requested;
        try {
          const latest = cloneSettings((await this.loadLatest()) ?? {});
          const merged = mergeChangedSettings(latest, requested.snapshot, requested.changedKeys);
          await this.saveMerged(merged);
          this.baseline = cloneSettings(merged);
          this.onPersisted?.(requested.snapshot, merged);
        } catch (error) {
          if (!this.pending) throw error;
        } finally {
          this.active = null;
        }
      }
    } finally {
      this.drainPromise = null;
    }
  }
}
