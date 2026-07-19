export type TaskHighlightHostMetadata = {
  taskPath?: string | null;
  tpsKanbanPath?: string | null;
  taskLine?: string | null;
  tpsKanbanLine?: string | null;
  dataLine?: string | null;
};

export type TaskHighlightContextMetadata = {
  filePath: string;
  lineNumber: number;
  lineIndex: number;
};

function parseIntegerAttribute(value: string, minimum: number): number | null {
  const normalized = String(value || '').trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
}

/**
 * Match explicit highlight metadata before any rendered-text/ordinal fallback.
 * TPS task surfaces publish one-based task lines; Obsidian's native data-line
 * attribute is zero-based. `null` means there was no positional metadata.
 */
export function matchTaskHighlightMetadata(
  host: TaskHighlightHostMetadata,
  context: TaskHighlightContextMetadata,
): boolean | null {
  const taskPath = String(host.taskPath || host.tpsKanbanPath || '').trim();
  if (taskPath && taskPath !== context.filePath) return false;

  const rawTaskLine = [host.taskLine, host.tpsKanbanLine]
    .find((value) => value != null && String(value).trim() !== '');
  if (rawTaskLine != null) {
    const taskLine = parseIntegerAttribute(String(rawTaskLine), 1);
    return taskLine != null && taskLine === context.lineNumber;
  }

  const rawDataLine = host.dataLine;
  if (rawDataLine != null && String(rawDataLine).trim() !== '') {
    const dataLine = parseIntegerAttribute(String(rawDataLine), 0);
    return dataLine != null && dataLine === context.lineIndex;
  }

  return null;
}
