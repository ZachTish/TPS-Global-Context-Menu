/** Normalize local input without discarding an authored timezone or precision. */
export function normalizeObsidianDateTimeValue(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  if (/<%[\s\S]*%>/.test(trimmed) || /\{\{[\s\S]*\}\}/.test(trimmed)) return trimmed;

  const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) return `${dateOnly[1]} 00:00:00`;

  // Match the complete local value. A prefix match would turn 16:00Z into
  // local 16:00, changing the instant by the device's UTC offset.
  const local = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?$/);
  if (local) return `${local[1]} ${local[2].padStart(2, '0')}:${local[3]}:${local[4] ?? '00'}${local[5] ?? ''}`;

  // Zoned ISO values belong to the author/provider; retain their exact instant,
  // offset, and fractional precision, including when Moment is unavailable.
  if (/^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/.test(trimmed)) return trimmed;

  const momentFactory = typeof window === 'undefined' ? undefined : (window as any).moment;
  if (typeof momentFactory === 'function') {
    const parsed = momentFactory(trimmed, [
      'YYYY-MM-DDTHH:mm:ss', 'YYYY-MM-DDTHH:mm',
      'YYYY-MM-DD HH:mm:ss', 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD',
      'ddd, MMM D YYYY h:mma', 'ddd, MMM D YYYY h.mm a',
      'ddd, MMM D YYYY h.mmA', 'ddd, MMM D YYYY',
      'MMM D, YYYY h:mma', 'MMM D, YYYY h:mm A', 'MMM D, YYYY',
    ], true);
    if (parsed?.isValid?.()) return parsed.format('YYYY-MM-DD HH:mm:ss');
  }
  return trimmed;
}
