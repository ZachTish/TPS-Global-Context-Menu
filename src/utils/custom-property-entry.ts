/** Custom-property controls read authored frontmatter; internal record identity stays separate. */
export function createCustomPropertyEntry<T>(file: T, frontmatter: Record<string, unknown>, nativeRecordKind?: string, calculatedPropertyKeys: readonly string[] = []):
  { file: T; frontmatter: Record<string, unknown>; nativeRecordKind?: string; calculatedPropertyKeys?: readonly string[] } {
  return { file, frontmatter, nativeRecordKind, calculatedPropertyKeys };
}

/** Mounted property panels track only indexed values, never body offsets. */
export function propertyPanelSignature(frontmatter: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(frontmatter)
    .filter(key => key !== 'position')
    .sort()
    .map(key => [key, frontmatter[key]]));
}
