export type TpsTableTotalsRowPosition = 'off' | 'top' | 'bottom';

export interface TpsTableTotalColumnInput {
  key: string;
  values: readonly unknown[];
}

export interface TpsTableTotals {
  values: Map<string, string>;
  labelKey: string | null;
}

const STRICT_NUMBER = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function normalizeTotalsRowPosition(value: unknown): TpsTableTotalsRowPosition {
  if (value === true) return 'bottom';
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'top' || normalized === 'bottom' ? normalized : 'off';
}

export function calculateTpsTableTotals(columns: readonly TpsTableTotalColumnInput[]): TpsTableTotals {
  const totals = new Map<string, string>();
  for (const column of columns) {
    if (!isSummableColumnKey(column.key)) continue;
    const values = column.values
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
    if (!values.length) continue;

    const parsed = values.map(parseStrictNumber);
    if (parsed.some((value) => value == null)) continue;
    const numbers = parsed as number[];
    const precision = Math.min(6, Math.max(0, ...values.map(decimalPrecision)));
    totals.set(column.key, formatTotal(numbers.reduce((sum, value) => sum + value, 0), precision));
  }

  return {
    values: totals,
    labelKey: columns.find((column) => !totals.has(column.key))?.key ?? null,
  };
}

function isSummableColumnKey(key: string): boolean {
  const canonical = String(key || '')
    .replace(/^(?:note|line|log)\./i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .trim()
    .toLowerCase();
  const compact = canonical.replace(/[^a-z0-9]/g, '');
  if (!canonical || canonical.startsWith('file.')) return false;
  if (['line', 'linenumber', 'title', 'source', 'path', 'filename', 'basename'].includes(compact)) return false;
  return !/(?:^|[._-])(?:date|time|timestamp|id|unit)$/.test(canonical);
}

function parseStrictNumber(value: string): number | null {
  if (!STRICT_NUMBER.test(value)) return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function decimalPrecision(value: string): number {
  const mantissa = value.replace(/,/g, '').split(/e/i, 1)[0];
  return mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0;
}

function formatTotal(value: number, precision: number): string {
  const safeValue = Math.abs(value) < 1e-12 ? 0 : value;
  const fixed = safeValue.toFixed(precision);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}
