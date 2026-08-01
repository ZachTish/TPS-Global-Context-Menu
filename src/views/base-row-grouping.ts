import { getTpsFormulaGroupValues } from '../services/tps-base-formula-service';

export type TpsBaseGroupDirection = 'asc' | 'desc';

export type TpsBaseGroupDescriptor = {
  property: string;
  direction: TpsBaseGroupDirection;
};

export type TpsBaseRowGroup<T> = {
  key: string | null;
  rows: T[];
};

export type SourceNoteLike = {
  path: string;
  name: string;
  basename: string;
  extension: string;
  parent?: { path?: string | null } | null;
};

const SOURCE_NOTE_PATH_PROPERTIES = new Set([
  'file.path',
  'task.path',
  'task.file.path',
  'line.path',
  'heading.path',
]);

const SOURCE_NOTE_PROPERTIES = new Set([
  ...SOURCE_NOTE_PATH_PROPERTIES,
  'file.name',
  'file.basename',
  'file.link',
  'file.folder',
  'file.ext',
  'file.extension',
]);

export function normalizeBaseGroupProperty(property: unknown): string {
  return String(property ?? '').trim().toLowerCase();
}

export function isSourceNoteGroupProperty(property: unknown): boolean {
  return SOURCE_NOTE_PROPERTIES.has(normalizeBaseGroupProperty(property));
}

/**
 * Resolve the synthesized row value that corresponds to the Markdown note
 * containing a TPS List task/bullet/heading or TPS Table line.
 *
 * `undefined` means the requested property is not a source-note property;
 * `null` means it is supported but the note has no value (for example, a root
 * note grouped by `file.folder`).
 */
export function getSourceNoteGroupValue(file: SourceNoteLike | null | undefined, property: unknown): string | null | undefined {
  const normalized = normalizeBaseGroupProperty(property);
  if (!SOURCE_NOTE_PROPERTIES.has(normalized)) return undefined;
  if (!file) return null;
  if (SOURCE_NOTE_PATH_PROPERTIES.has(normalized)) return cleanGroupValue(file.path);
  if (normalized === 'file.name') return cleanGroupValue(file.name);
  if (normalized === 'file.basename' || normalized === 'file.link') return cleanGroupValue(file.basename);
  if (normalized === 'file.folder') return cleanGroupValue(file.parent?.path);
  if (normalized === 'file.ext' || normalized === 'file.extension') return cleanGroupValue(file.extension);
  return undefined;
}

/**
 * Bases lane IDs are case-insensitive even when their display labels retain
 * the source value's casing. Use the same normalized ID for native groups and
 * synthesized task rows so paths such as `Inbox/Tasks.md` join the lane that
 * Bases exposes for that note instead of becoming an unreachable duplicate.
 */
export function getTpsBaseGroupLaneId(value: unknown): string {
  const label = cleanGroupValue(value);
  return label ? `key:${label.toLowerCase()}` : 'ungrouped';
}

export function resolveTpsBaseGroupDescriptor(raw: unknown): TpsBaseGroupDescriptor | null {
  const property = typeof raw === 'string'
    ? raw.trim()
    : String((raw as any)?.property ?? (raw as any)?.field ?? (raw as any)?.key ?? '').trim();
  if (!property) return null;
  const rawDirection = String((raw as any)?.direction ?? (raw as any)?.dir ?? (raw as any)?.order ?? '').trim().toLowerCase();
  return {
    property,
    direction: rawDirection === 'desc' || rawDirection === 'descending' ? 'desc' : 'asc',
  };
}

export function groupTpsBaseRows<T>(
  rows: T[],
  getValue: (row: T) => unknown,
  direction: TpsBaseGroupDirection = 'asc',
): TpsBaseRowGroup<T>[] {
  const keyed = new Map<string, TpsBaseRowGroup<T>>();
  const ungrouped: T[] = [];

  for (const row of rows) {
    const values = cleanGroupValues(getValue(row));
    if (!values.length) {
      ungrouped.push(row);
      continue;
    }
    for (const value of values) {
      const normalized = value.toLocaleLowerCase();
      const group = keyed.get(normalized) ?? { key: value, rows: [] };
      group.rows.push(row);
      keyed.set(normalized, group);
    }
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const groups = Array.from(keyed.values()).sort((left, right) => {
    const result = collator.compare(left.key ?? '', right.key ?? '');
    return direction === 'desc' ? -result : result;
  });
  if (ungrouped.length) groups.push({ key: null, rows: ungrouped });
  return groups;
}

function cleanGroupValue(value: unknown): string | null {
  const text = getTpsFormulaGroupValues(value)[0] ?? '';
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return null;
  return text;
}

function cleanGroupValues(value: unknown): string[] {
  return getTpsFormulaGroupValues(value);
}
