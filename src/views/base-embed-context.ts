export function resolveBaseEmbedSourcePath(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const path = String(candidate || '').trim().replace(/^\/+/, '');
    if (path.toLowerCase().endsWith('.md')) return path;
  }
  return null;
}
