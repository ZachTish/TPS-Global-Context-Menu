/** undefined means legacy/free-text input; null means an invalid complete date. */
export function parseCompleteScheduleDateMillis(input: unknown): number | null | undefined {
  if (input instanceof Date) return Number.isFinite(input.getTime()) ? input.getTime() : null;
  if (typeof input !== 'string') return undefined;
  const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?([Zz]|[+-]\d{2}(?::?\d{2})?)?)?$/);
  if (!match) return undefined;
  const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = '', offset = ''] = match;
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  if (calendarDate.getUTCFullYear() !== Number(year)
    || calendarDate.getUTCMonth() !== Number(month) - 1
    || calendarDate.getUTCDate() !== Number(day)
    || Number(hour) > 24 || Number(minute) > 59 || Number(second) > 59
    || (Number(hour) === 24 && (Number(minute) !== 0 || Number(second) !== 0 || Number(fraction) !== 0))) return null;
  const normalizedOffset = /^[Zz]$/.test(offset) ? 'Z' : /^[+-]\d{2}$/.test(offset) ? `${offset}:00` : offset;
  // Date-only and zone-less values stay local. Zoned values retain the exact
  // instant instead of having their seconds/offset removed by prefix parsing.
  const timestamp = new Date(`${year}-${month}-${day}T${hour.padStart(2, '0')}:${minute}:${second}${fraction}${normalizedOffset}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export class SharedScheduleService {
  private getMoment(): any {
    return typeof window === 'undefined' ? undefined : (window as any).moment;
  }

  parseDate(input: unknown): Date | null {
    const millis = this.parseDateMillis(input);
    return millis == null ? null : new Date(millis);
  }

  parseDateMillis(input: unknown): number | null {
    if (input == null) return null;
    let raw = Array.isArray(input) ? input[0] : input;
    if (raw == null) return null;
    const completeInput = parseCompleteScheduleDateMillis(raw);
    if (completeInput !== undefined) return completeInput;
    raw = String(raw).replace(/[\[\]]/g, '').trim();
    if (!raw) return null;
    const completeRaw = parseCompleteScheduleDateMillis(raw);
    if (completeRaw !== undefined) return completeRaw;

    const rangeSplit = String(raw).split(/\s+[-–]\s+/);
    if (rangeSplit.length > 1) {
      raw = rangeSplit[0].trim();
    } else {
      const compactMatch = String(raw).match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
      if (compactMatch) raw = compactMatch[1];
    }

    const completeRangeStart = parseCompleteScheduleDateMillis(raw);
    if (completeRangeStart !== undefined) return completeRangeStart;

    const dateTimeMatch = String(raw).match(/(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}(?:\s*[AP]M?)?))?/i);
    if (dateTimeMatch) raw = dateTimeMatch[0];

    const formats = [
      'YYYY-MM-DD HH:mm:ss',
      'YYYY-MM-DD HH:mm',
      'YYYY-MM-DD H:mm',
      'YYYY-MM-DD HH:mm A',
      'YYYY-MM-DD h:mm A',
      'YYYY-MM-DDTHH:mm:ss',
      'YYYY-MM-DDTHH:mm',
      'YYYY-MM-DD',
      'HH:mm',
      'H:mm',
      'hh:mm A',
      'h:mm A',
      this.getMoment()?.ISO_8601,
    ];

    const moment = this.getMoment();
    if (!moment) return null;

    const parsed = moment(raw as string, formats, true);
    if (parsed.isValid()) return parsed.valueOf();

    if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(String(raw)) || /\d{1,2}:\d{2}/.test(String(raw))) {
      const originalSuppress = moment.suppressDeprecationWarnings;
      moment.suppressDeprecationWarnings = true;
      try {
        const fallback = moment(raw as string);
        return fallback.isValid() ? fallback.valueOf() : null;
      } finally {
        moment.suppressDeprecationWarnings = originalSuppress;
      }
    }

    return null;
  }

  parseTimeRange(input: unknown): { start: number | null; end: number | null } {
    if (input == null) return { start: null, end: null };
    let raw = Array.isArray(input) ? input[0] : input;
    const completeInput = parseCompleteScheduleDateMillis(raw);
    if (completeInput !== undefined) return { start: completeInput, end: null };
    raw = String(raw ?? '').replace(/[\[\]]/g, '').trim();
    if (!raw) return { start: null, end: null };
    const completeRaw = parseCompleteScheduleDateMillis(raw);
    if (completeRaw !== undefined) return { start: completeRaw, end: null };

    let startRaw = raw;
    let endRaw: string | null = null;
    const split = raw.split(/\s+[-–]\s+/);
    if (split.length > 1) {
      startRaw = split[0].trim();
      endRaw = split[split.length - 1].trim();
    } else {
      const compactMatch = raw.match(/\b(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\b/);
      if (compactMatch) endRaw = compactMatch[2];
    }

    const start = this.parseDateMillis(startRaw);
    if (start == null) return { start: null, end: null };

    let end: number | null = null;
    if (endRaw) {
      if (/^\d{1,2}:\d{2}(?:\s*[AP]M?)?$/i.test(endRaw)) {
        const moment = this.getMoment();
        if (!moment) return { start, end: null };
        const time = moment(endRaw, ['H:mm', 'HH:mm', 'h:mm A'], true);
        if (time.isValid()) {
          end = moment(start).set({ hour: time.hour(), minute: time.minute() }).valueOf();
          if (end < start) end = moment(end).add(1, 'day').valueOf();
        }
      } else {
        end = this.parseDateMillis(endRaw);
      }
    }

    return { start, end };
  }

  parseDuration(input: unknown): number {
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (input == null) return 0;

    const str = String(input).trim().toLowerCase();
    const hoursMatch = str.match(/(\d+(?:\.\d+)?)h/);
    const minsMatch = str.match(/(\d+(?:\.\d+)?)m/);

    let minutes = 0;
    if (hoursMatch) minutes += parseFloat(hoursMatch[1]) * 60;
    if (minsMatch) minutes += parseFloat(minsMatch[1]);
    if (minutes > 0) return minutes;

    const numeric = parseFloat(str);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  isAllDayValue(rawPropertyValue: unknown, frontmatter?: Record<string, unknown> | null): boolean {
    const allDay = frontmatter?.allDay;
    if (allDay === true || String(allDay ?? '').toLowerCase() === 'true') return true;
    if (rawPropertyValue == null) return false;
    const raw = String(Array.isArray(rawPropertyValue) ? rawPropertyValue[0] : rawPropertyValue)
      .replace(/[\[\]]/g, '')
      .trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(raw);
  }

  hasExplicitTimeInValue(rawValue: unknown): boolean {
    const raw = Array.isArray(rawValue) ? rawValue[0] : rawValue;
    const value = String(raw ?? '').replace(/[\[\]]/g, '').trim();
    if (!value) return false;
    return /[T ]\d{1,2}:\d{2}/.test(value) || /\b\d{1,2}:\d{2}\s*(AM|PM)\b/i.test(value);
  }

  formatDateTimeForFrontmatter(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
}
