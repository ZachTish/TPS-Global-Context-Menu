export type DailyNoteHomeSettingTransactionStatus =
  | 'applied'
  | 'rolled-back'
  | 'recovered-requested'
  | 'unresolved'
  | 'stale'
  | 'unavailable';

export interface DailyNoteHomeSettingTransactionResult {
  status: DailyNoteHomeSettingTransactionStatus;
  effectiveValue: boolean;
  persisted: boolean;
  error?: unknown;
  rollbackError?: unknown;
  recoveryError?: unknown;
  persistenceError?: unknown;
}

export interface DailyNoteHomeSettingTransactionOptions {
  requestedValue: boolean;
  previousValue: boolean;
  applyEnabled: (enabled: boolean) => Promise<boolean>;
  getEnabled: () => boolean;
  setSetting: (enabled: boolean) => void;
  persist: () => Promise<void>;
  isCurrent: () => boolean;
  isAvailable: () => boolean;
}

const interruptedResult = (
  options: DailyNoteHomeSettingTransactionOptions,
): DailyNoteHomeSettingTransactionResult => ({
  status: options.isAvailable() ? 'stale' : 'unavailable',
  effectiveValue: options.getEnabled(),
  persisted: false,
});

const canContinue = (options: DailyNoteHomeSettingTransactionOptions): boolean =>
  options.isCurrent() && options.isAvailable();

export async function runDailyNoteHomeSettingTransaction(
  options: DailyNoteHomeSettingTransactionOptions,
): Promise<DailyNoteHomeSettingTransactionResult> {
  if (!canContinue(options)) return interruptedResult(options);

  let primaryError: unknown;
  try {
    const applied = await options.applyEnabled(options.requestedValue);
    if (!canContinue(options)) return interruptedResult(options);
    if (!applied) throw new Error('One or more date-backed Home leaves could not be restored.');
    options.setSetting(options.requestedValue);
    await options.persist();
    if (!canContinue(options)) return interruptedResult(options);
    return {
      status: 'applied',
      effectiveValue: options.requestedValue,
      persisted: true,
    };
  } catch (error) {
    primaryError = error;
  }

  if (!canContinue(options)) return interruptedResult(options);
  options.setSetting(options.previousValue);
  let rollbackApplied = false;
  let rollbackError: unknown;
  try {
    rollbackApplied = await options.applyEnabled(options.previousValue);
  } catch (error) {
    rollbackError = error;
  }
  if (!canContinue(options)) return interruptedResult(options);

  if (rollbackApplied) {
    try {
      await options.persist();
      if (!canContinue(options)) return interruptedResult(options);
      return {
        status: 'rolled-back',
        effectiveValue: options.previousValue,
        persisted: true,
        error: primaryError,
        ...(rollbackError ? { rollbackError } : {}),
      };
    } catch (persistenceError) {
      if (!canContinue(options)) return interruptedResult(options);
      return {
        status: 'rolled-back',
        effectiveValue: options.previousValue,
        persisted: false,
        error: primaryError,
        ...(rollbackError ? { rollbackError } : {}),
        persistenceError,
      };
    }
  }

  options.setSetting(options.requestedValue);
  let requestedStateRecovered = false;
  let recoveryError: unknown;
  try {
    requestedStateRecovered = await options.applyEnabled(options.requestedValue);
  } catch (error) {
    recoveryError = error;
  }
  if (!canContinue(options)) return interruptedResult(options);

  const effectiveValue = requestedStateRecovered
    ? options.requestedValue
    : options.getEnabled();
  options.setSetting(effectiveValue);
  let persisted = false;
  let persistenceError: unknown;
  try {
    await options.persist();
    persisted = true;
  } catch (error) {
    persistenceError = error;
  }
  if (!canContinue(options)) return interruptedResult(options);

  return {
    status: requestedStateRecovered ? 'recovered-requested' : 'unresolved',
    effectiveValue,
    persisted,
    error: primaryError,
    ...(rollbackError ? { rollbackError } : {}),
    ...(recoveryError ? { recoveryError } : {}),
    ...(persistenceError ? { persistenceError } : {}),
  };
}
