export const FRONTMATTER_DELIMITER_LINE_PATTERN = /^---[\t ]*$/;

export function isFrontmatterDelimiterLine(value: string): boolean {
  return FRONTMATTER_DELIMITER_LINE_PATTERN.test(String(value || ''));
}
