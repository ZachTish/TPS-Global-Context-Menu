import type { CustomProperty } from "../types";

export interface CustomPropertyMenuFilterOptions {
  readonly excludeCustomPropertyKeys?: readonly string[];
  readonly excludeStandardTagProperties?: boolean;
}

function normalizePropertyIdentity(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

/** Builds one stable predicate for a menu render instead of redoing option work per row. */
export function createCustomPropertyMenuExclusionPredicate(
  options: CustomPropertyMenuFilterOptions,
): (property: CustomProperty) => boolean {
  const excludedKeys = new Set(
    (options.excludeCustomPropertyKeys || [])
      .map(normalizePropertyIdentity)
      .filter(Boolean),
  );

  return (property) => {
    const key = normalizePropertyIdentity(property.key);
    const id = normalizePropertyIdentity(property.id);
    if (excludedKeys.has(key) || excludedKeys.has(id)) return true;
    if (options.excludeStandardTagProperties !== true) return false;
    return key === "tag" || key === "tags" || id === "tag" || id === "tags";
  };
}
