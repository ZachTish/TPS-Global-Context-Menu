export function getFrontmatterPropNameFromId(propId: unknown): string | null {
  const raw = String(propId ?? '').trim();
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot === -1) return raw;
  return raw.slice(0, dot) === 'note' ? raw.slice(dot + 1) : null;
}

export function normalizeGroupToken(value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/^['"]+|['"]+$/g, '').trim();
}

export function extractGroupValues(raw: unknown): string[] {
  if (raw == null) return [];

  if (Array.isArray(raw)) {
    return raw.map((value) => String(value ?? '').trim()).filter(Boolean);
  }

  if (raw instanceof Set) {
    return Array.from(raw.values()).map((value) => String(value ?? '').trim()).filter(Boolean);
  }

  if (typeof raw === 'object') {
    const anyRaw = raw as { values?: unknown[] };
    if (Array.isArray(anyRaw.values)) {
      return anyRaw.values.map((value) => String(value ?? '').trim()).filter(Boolean);
    }
  }

  const scalar = String(raw).trim();
  if (!scalar) return [];
  const unwrapped = scalar.startsWith('[') && scalar.endsWith(']') ? scalar.slice(1, -1) : scalar;
  if (!/[,;\n]/.test(unwrapped)) return [normalizeGroupToken(unwrapped)];

  return unwrapped.split(/[,;\n]/g).map((part) => normalizeGroupToken(part)).filter(Boolean);
}
