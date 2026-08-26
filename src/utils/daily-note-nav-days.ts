export const DEFAULT_DAILY_NAV_DAY_COUNT = 7;

export function normalizeDailyNavDayCount(value: unknown): number {
  if (value === null || value === undefined) return DEFAULT_DAILY_NAV_DAY_COUNT;
  const text = typeof value === 'string' ? value.trim() : null;
  if (text === '') return DEFAULT_DAILY_NAV_DAY_COUNT;
  const parsed = typeof value === 'number' ? value : Number(text ?? value);
  if (!Number.isFinite(parsed)) return DEFAULT_DAILY_NAV_DAY_COUNT;
  return Math.min(7, Math.max(1, Math.floor(parsed)));
}

/**
 * Returns day offsets relative to the active Daily Note.
 * Seven days retain the historical ISO Monday-Sunday week. Shorter ranges
 * stay contiguous around the active day, with the extra day on the left for
 * even counts.
 */
export function getDailyNavDayOffsets(dayCount: unknown, activeIsoWeekday: unknown): number[] {
  const normalizedCount = normalizeDailyNavDayCount(dayCount);
  if (normalizedCount === 7) {
    const parsedWeekday = Number(activeIsoWeekday);
    const normalizedWeekday = Number.isFinite(parsedWeekday)
      ? Math.min(7, Math.max(1, Math.floor(parsedWeekday)))
      : 1;
    return Array.from({ length: 7 }, (_, index) => index - (normalizedWeekday - 1));
  }

  const firstOffset = -Math.floor(normalizedCount / 2);
  return Array.from({ length: normalizedCount }, (_, index) => firstOffset + index);
}
