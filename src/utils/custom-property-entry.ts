/** Custom-property controls read authored frontmatter; internal record identity stays separate. */
export function createCustomPropertyEntry<T>(file: T, frontmatter: Record<string, unknown>, nativeRecordKind?: string):
  { file: T; frontmatter: Record<string, unknown>; nativeRecordKind?: string } {
  return { file, frontmatter, nativeRecordKind };
}
