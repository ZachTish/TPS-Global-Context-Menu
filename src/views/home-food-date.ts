export function extractHomeFoodIsoDate(value: unknown): string | null {
  const match = String(value || '').match(/(?:^|[^0-9])(\d{4})[-/](\d{2})[-/](\d{2})(?:[^0-9]|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function resolveHomeFoodLineDateKey(fields: Record<string, string>, sourcePath: string): string | null {
  return extractHomeFoodIsoDate(fields.dailynotepath)
    || extractHomeFoodIsoDate(sourcePath)
    || extractHomeFoodIsoDate(fields.completeddate)
    || extractHomeFoodIsoDate(fields.completed)
    || extractHomeFoodIsoDate(fields.createddate)
    || extractHomeFoodIsoDate(fields.created)
    || extractHomeFoodIsoDate(fields.date);
}
