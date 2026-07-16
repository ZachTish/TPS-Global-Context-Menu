export function resolveHomeBaseDefinitionSourcePath(serialized: string, sourcePath: string): string {
  const normalizedPath = String(sourcePath || '').trim();
  if (!serialized || !normalizedPath) return serialized;
  try {
    const definition = JSON.parse(serialized) as unknown;
    return JSON.stringify(replaceSourcePathTokens(definition, normalizedPath));
  } catch {
    return serialized;
  }
}

export function addHomeBaseContextFilter(serialized: string, filter: string): string {
  const normalizedFilter = String(filter || '').trim();
  if (!serialized || !normalizedFilter) return serialized;
  try {
    const definition = JSON.parse(serialized) as Record<string, unknown>;
    const existing = definition.filters;
    definition.filters = existing == null
      ? { and: [normalizedFilter] }
      : { and: [existing, normalizedFilter] };
    return JSON.stringify(definition);
  } catch {
    return serialized;
  }
}

function replaceSourcePathTokens(value: unknown, sourcePath: string): unknown {
  if (typeof value === 'string') {
    return value.replace(/\bthis\.file\.path\b/g, JSON.stringify(sourcePath));
  }
  if (Array.isArray(value)) return value.map((entry) => replaceSourcePathTokens(entry, sourcePath));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, replaceSourcePathTokens(entry, sourcePath)]),
  );
}
