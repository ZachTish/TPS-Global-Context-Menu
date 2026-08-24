export interface TpsBaseRefreshTimers {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

/**
 * One trailing refresh boundary shared by the custom Base views.
 *
 * Bases can emit several data/configuration updates for one authored filter
 * change. Resetting the timer keeps those updates from starting overlapping
 * full-vault evaluation and DOM replacement work.
 */
export class TpsBaseRefreshCoordinator {
  private timerId: number | null = null;

  constructor(
    private readonly callback: () => void,
    private readonly delayMs: number,
    private readonly timers: TpsBaseRefreshTimers = {
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (timerId) => window.clearTimeout(timerId),
    },
  ) {}

  request(): void {
    if (this.timerId != null) this.timers.clearTimeout(this.timerId);
    this.timerId = this.timers.setTimeout(() => {
      this.timerId = null;
      this.callback();
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timerId == null) return;
    this.timers.clearTimeout(this.timerId);
    this.timerId = null;
  }
}
