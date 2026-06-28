export function normalizeCheckboxStateToken(input: string): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return '[ ]';

  const bracketMatch = raw.match(/^\[([^\]\r\n]?)\]$/);
  if (bracketMatch) {
    return `[${bracketMatch[1] ?? ' '}]`;
  }

  if (raw.length !== 1 || raw === '[' || raw === ']') return null;
  return `[${raw}]`;
}

export function getCheckboxStateMarker(token: string | null | undefined): string {
  const match = String(token || '').match(/^\[([^\]\r\n]?)\]$/);
  return match ? (match[1] ?? ' ') : ' ';
}

export function isSupportedSingleCharCheckboxToken(token: string | null | undefined): boolean {
  return /^\[[^\]\r\n]?\]$/.test(String(token || ''));
}
