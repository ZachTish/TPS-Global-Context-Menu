export interface EditableNotePreviewRequest {
  filePath: string;
  anchorEl: HTMLElement;
  sourcePluginId: string;
  focusEditor?: boolean;
}

export interface NormalizedEditableNotePreviewRequest {
  filePath: string;
  anchorEl: HTMLElement;
  sourcePluginId: string;
  focusEditor: boolean;
}

const SOURCE_PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function isSafeVaultRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\0')) return false;
  const segments = path.replace(/\\/g, '/').split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function normalizeEditableNotePreviewRequest(
  request: unknown,
): NormalizedEditableNotePreviewRequest | null {
  if (!request || typeof request !== 'object') return null;
  const candidate = request as Partial<EditableNotePreviewRequest>;
  const sourcePluginId = typeof candidate.sourcePluginId === 'string'
    ? candidate.sourcePluginId.trim()
    : '';
  const filePath = typeof candidate.filePath === 'string'
    ? candidate.filePath.trim().replace(/\\/g, '/')
    : '';
  const anchorEl = candidate.anchorEl;

  if (!SOURCE_PLUGIN_ID_PATTERN.test(sourcePluginId)) return null;
  if (!isSafeVaultRelativePath(filePath)) return null;
  if (!anchorEl || anchorEl.isConnected !== true) return null;

  return {
    sourcePluginId,
    filePath,
    anchorEl,
    focusEditor: candidate.focusEditor === true,
  };
}
