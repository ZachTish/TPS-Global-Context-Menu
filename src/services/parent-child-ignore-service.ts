export type ParentChildIgnoreSettings = {
  enableParentChildIgnoreRule?: unknown;
  parentChildIgnoreFrontmatterKey?: unknown;
  parentChildIgnoreFrontmatterValue?: unknown;
};

export type ParentChildIgnoreRule = {
  enabled: boolean;
  key: string;
  value: string;
};

/**
 * Resolve the configured parent/child ignore pair without exposing the wider
 * settings object to relationship consumers. A partial or disabled rule never
 * matches, preserving all pre-feature behavior.
 */
export function resolveParentChildIgnoreRule(settings: ParentChildIgnoreSettings | null | undefined): ParentChildIgnoreRule {
  const key = String(settings?.parentChildIgnoreFrontmatterKey ?? '').trim();
  const value = String(settings?.parentChildIgnoreFrontmatterValue ?? '').trim();
  return {
    enabled: settings?.enableParentChildIgnoreRule === true && Boolean(key) && Boolean(value),
    key,
    value,
  };
}

/**
 * Match one exact frontmatter key/value pair. Keys and scalar values are
 * case-insensitive and whitespace-trimmed; an array matches when any scalar
 * member matches. Objects never stringify into accidental matches.
 */
export function matchesParentChildIgnoreRule(
  frontmatter: Record<string, unknown> | null | undefined,
  settings: ParentChildIgnoreSettings | null | undefined,
): boolean {
  const rule = resolveParentChildIgnoreRule(settings);
  if (!rule.enabled || !frontmatter || typeof frontmatter !== 'object') return false;

  const configuredKey = rule.key.toLowerCase();
  const actualKey = Object.keys(frontmatter).find(
    (candidate) => candidate.trim().toLowerCase() === configuredKey,
  );
  if (!actualKey) return false;

  const expected = rule.value.toLowerCase();
  const matchesValue = (raw: unknown): boolean => {
    if (Array.isArray(raw)) return raw.some(matchesValue);
    if (raw == null || typeof raw === 'object') return false;
    return String(raw).trim().toLowerCase() === expected;
  };

  return matchesValue(frontmatter[actualKey]);
}
