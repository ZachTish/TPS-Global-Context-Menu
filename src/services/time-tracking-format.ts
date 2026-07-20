export type TimeTrackingTargetType = 'note' | 'heading' | 'bullet' | 'task' | 'line';
export type TimeTrackingStorageMode = 'daily-note' | 'source-note' | 'dedicated-note';

export interface TimeTrackingSessionRecord {
  id: string;
  targetId: string;
  targetType: TimeTrackingTargetType;
  sourcePath: string;
  lineNumber?: number;
  start: string;
  end?: string;
  durationMinutes?: number;
  createdAt: string;
  updatedAt: string;
}

export function normalizeTimeTrackingRecordList(value: unknown): TimeTrackingSessionRecord[] {
  const source = Array.isArray(value) ? value : value == null ? [] : [value];
  const records: TimeTrackingSessionRecord[] = [];
  for (const item of source) {
    const parsed = normalizeTimeTrackingRecord(item);
    if (parsed) records.push(parsed);
  }
  return records;
}

export function normalizeTimeTrackingRecord(value: unknown): TimeTrackingSessionRecord | null {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  const id = String(record.id || '').trim();
  const start = String(record.start || '').trim();
  const targetId = String(record.targetId || record.tpsId || '').trim();
  if (!id || !start || !targetId) return null;

  const typeRaw = String(record.targetType || '').trim() as TimeTrackingTargetType;
  const targetType: TimeTrackingTargetType =
    typeRaw === 'heading' || typeRaw === 'bullet' || typeRaw === 'task' || typeRaw === 'line'
      ? typeRaw
      : 'note';
  const sourcePath = String(record.sourcePath || '').trim();
  const lineNumber = Number(record.lineNumber);
  const durationMinutes = Number(record.durationMinutes);

  return {
    id,
    targetId,
    targetType,
    sourcePath,
    lineNumber: Number.isFinite(lineNumber) ? lineNumber : undefined,
    start,
    end: String(record.end || '').trim() || undefined,
    durationMinutes: Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : undefined,
    createdAt: String(record.createdAt || start).trim() || start,
    updatedAt: String(record.updatedAt || record.end || start).trim() || start,
  };
}

export function resolveTimeTrackingStorageKind(
  storageMode: TimeTrackingStorageMode,
  targetType: TimeTrackingTargetType,
): 'frontmatter' {
  void storageMode;
  void targetType;
  return 'frontmatter';
}

export function timeTrackingSessionOverlapsRange(
  record: TimeTrackingSessionRecord,
  rangeStart: number | null,
  rangeEnd: number | null,
  activeEndMillis = Date.now(),
  parseDate: (value: string) => Date | null = defaultParseDate,
): boolean {
  if (rangeStart == null && rangeEnd == null) return true;
  const start = parseDate(record.start)?.getTime();
  if (start == null) return false;
  const end = record.end ? parseDate(record.end)?.getTime() : activeEndMillis;
  if (end == null) return false;
  if (rangeStart != null && end < rangeStart) return false;
  if (rangeEnd != null && start > rangeEnd) return false;
  return true;
}

export function timeTrackingSessionMatchesTarget(
  session: Pick<TimeTrackingSessionRecord, 'targetType' | 'sourcePath'> & { targetPath?: string },
  path: string,
  targetType: TimeTrackingTargetType,
): boolean {
  return session.targetType === targetType
    && (session.targetPath === path || session.sourcePath === path);
}

function defaultParseDate(value: string): Date | null {
  const parsed = new Date(String(value || ''));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
