const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([^\]\r\n]?)\](\s*)(.*)$/;
const INLINE_FIELD_GLOBAL_RE = /(?:^|\s)([\[(])\s*([A-Za-z0-9_-]+)\s*::\s*([^\]\)]*)[\])]/g;
const TAG_GLOBAL_RE = /(?:^|\s)(#[A-Za-z0-9_/-]+)/g;

export interface ParsedTaskLine {
  prefix: string;
  marker: string;
  token: string;
  body: string;
}

export const TASK_COMPLETED_DATE_FIELD = 'completedDate';

export interface TaskLineTimestampOptions {
  createdKey?: string;
  modifiedKey?: string;
  format?: string;
  now?: Date;
  markCreated?: boolean;
  markModified?: boolean;
}

export function parseTaskLine(line: string): ParsedTaskLine | null {
  const match = String(line || '').match(TASK_LINE_RE);
  if (!match) return null;
  const marker = String(match[2] ?? ' ');
  return {
    prefix: String(match[1] || ''),
    marker,
    token: `[${marker}]`,
    body: String(match[4] || '').trim(),
  };
}

export function getTaskDisplayTitle(line: string): string {
  const parsed = parseTaskLine(line);
  if (!parsed) return '';
  return stripTaskMetadata(parsed.body);
}

export function setTaskCheckboxToken(line: string, token: string): string {
  const normalizedToken = normalizeCheckboxToken(token);
  if (!normalizedToken) return line;
  return String(line || '').replace(TASK_LINE_RE, (_match, prefix: string, _marker: string, _gap: string, body: string) => {
    return `${prefix}${normalizedToken} ${String(body || '').trimStart()}`.trimEnd();
  });
}

export function updateTaskCompletedDateForCheckboxState(
  line: string,
  checkboxState: string | null | undefined,
  options: { completeMarkers?: string[]; completedAt?: Date } = {},
): string {
  const parsed = parseTaskLine(line);
  if (!parsed) return line;
  const marker = normalizeCheckboxMarker(checkboxState ?? parsed.token);
  const completeMarkers = normalizeCompleteMarkers(options.completeMarkers);
  if (completeMarkers.has(marker)) {
    if (readInlineFieldValue(line, TASK_COMPLETED_DATE_FIELD)) return line;
    return setInlineFieldValueOnTaskLine(
      line,
      TASK_COMPLETED_DATE_FIELD,
      formatTaskLineDate(options.completedAt ?? new Date()),
    );
  }
  if (!readInlineFieldValue(line, TASK_COMPLETED_DATE_FIELD)) return line;
  return setInlineFieldValueOnTaskLine(line, TASK_COMPLETED_DATE_FIELD, null);
}

export function updateTaskLineTimestamps(
  line: string,
  options: TaskLineTimestampOptions = {},
): string {
  if (!parseTaskLine(line)) return line;
  const now = options.now ?? new Date();
  const formatted = formatTaskLineTimestamp(now, options.format);
  let next = line;
  const createdKey = normalizeInlineFieldKey(options.createdKey || 'datecreated');
  const modifiedKey = normalizeInlineFieldKey(options.modifiedKey || 'datemodified');
  if (options.markCreated === true && createdKey && !readInlineFieldValue(next, createdKey)) {
    next = setInlineFieldValueOnTaskLine(next, createdKey, formatted);
  }
  if (options.markModified === true && modifiedKey) {
    next = setInlineFieldValueOnTaskLine(next, modifiedKey, formatted);
  }
  return next;
}

export function setTaskTitle(line: string, title: string): string {
  const parsed = parseTaskLine(line);
  if (!parsed) return line;
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  if (!cleanTitle) return line;
  const metadata = extractTaskMetadata(parsed.body);
  const suffix = metadata.length > 0 ? ` ${metadata.join(' ')}` : '';
  return `${parsed.prefix}${parsed.token} ${cleanTitle}${suffix}`.trimEnd();
}

export function readInlineFieldValue(line: string, key: string): string {
  const body = parseTaskLine(line)?.body ?? String(line || '');
  const normalizedKey = String(key || '').trim().toLowerCase();
  if (!normalizedKey) return '';
  INLINE_FIELD_GLOBAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_FIELD_GLOBAL_RE.exec(body)) !== null) {
    if (String(match[2] || '').trim().toLowerCase() === normalizedKey) {
      INLINE_FIELD_GLOBAL_RE.lastIndex = 0;
      return String(match[3] || '').trim();
    }
  }
  INLINE_FIELD_GLOBAL_RE.lastIndex = 0;
  return '';
}

export function setInlineFieldValueOnTaskLine(line: string, key: string, value: string | null): string {
  const parsed = parseTaskLine(line);
  if (!parsed) return line;
  const cleanKey = String(key || '').trim();
  if (!cleanKey) return line;
  const nextBody = setInlineFieldValueOnBody(parsed.body, cleanKey, value);
  return `${parsed.prefix}${parsed.token}${nextBody ? ` ${nextBody}` : ''}`.trimEnd();
}

export function readInlineTags(line: string): string[] {
  const body = parseTaskLine(line)?.body ?? String(line || '');
  const tags: string[] = [];
  const seen = new Set<string>();
  TAG_GLOBAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_GLOBAL_RE.exec(body)) !== null) {
    const tag = normalizeInlineTag(match[1]);
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      tags.push(tag);
      seen.add(key);
    }
  }
  TAG_GLOBAL_RE.lastIndex = 0;
  return tags;
}

export function addInlineTagToTaskLine(line: string, tag: string): string {
  const normalized = normalizeInlineTag(tag);
  if (!normalized) return line;
  const current = readInlineTags(line).map((value) => value.toLowerCase());
  if (current.includes(normalized.toLowerCase())) return line;
  return `${String(line || '').trimEnd()} #${normalized}`.trimEnd();
}

export function removeInlineTagFromTaskLine(line: string, tag: string): string {
  const normalized = normalizeInlineTag(tag).toLowerCase();
  if (!normalized) return line;
  return String(line || '')
    .replace(TAG_GLOBAL_RE, (raw, tagValue: string) => {
      return normalizeInlineTag(tagValue).toLowerCase() === normalized ? '' : raw;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trimEnd();
}

export function insertLineAfterFrontmatter(content: string, line: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const endsWithNewline = /\r?\n$/.test(content);
  const lines = content.split(/\r?\n/);
  if (endsWithNewline) lines.pop();
  const insertIndex = findAfterFrontmatterIndex(lines);
  const before = lines.slice(0, insertIndex);
  const after = lines.slice(insertIndex);
  while (after.length > 0 && after[0].trim() === '') after.shift();
  const nextLines = before.length > 0
    ? [...before, '', line, ...(after.length > 0 ? ['', ...after] : [])]
    : [line, ...(after.length > 0 ? ['', ...after] : [])];
  return `${nextLines.join(newline)}${newline}`;
}

export function findAfterFrontmatterIndex(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') return i + 1;
  }
  return 0;
}

export function stripTaskMetadata(body: string): string {
  return String(body || '')
    .replace(INLINE_FIELD_GLOBAL_RE, ' ')
    .replace(TAG_GLOBAL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function setInlineFieldValueOnBody(body: string, key: string, value: string | null): string {
  const cleanValue = String(value ?? '').trim();
  const withoutExisting = removeInlineFieldFromBody(body, key);
  if (!cleanValue) return withoutExisting;
  return `${withoutExisting.trimEnd()} [${key}:: ${cleanValue}]`.trim();
}

function removeInlineFieldFromBody(body: string, key: string): string {
  const normalizedKey = String(key || '').trim().toLowerCase();
  if (!normalizedKey) return String(body || '').trimEnd();
  return String(body || '')
    .replace(INLINE_FIELD_GLOBAL_RE, (raw, _open: string, fieldKey: string) => {
      return String(fieldKey || '').trim().toLowerCase() === normalizedKey ? '' : raw;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractTaskMetadata(body: string): string[] {
  const output: string[] = [];
  INLINE_FIELD_GLOBAL_RE.lastIndex = 0;
  let fieldMatch: RegExpExecArray | null;
  while ((fieldMatch = INLINE_FIELD_GLOBAL_RE.exec(body)) !== null) {
    output.push(String(fieldMatch[0] || '').trim());
  }
  INLINE_FIELD_GLOBAL_RE.lastIndex = 0;

  TAG_GLOBAL_RE.lastIndex = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = TAG_GLOBAL_RE.exec(body)) !== null) {
    output.push(String(tagMatch[1] || '').trim());
  }
  TAG_GLOBAL_RE.lastIndex = 0;
  return Array.from(new Set(output.filter(Boolean)));
}

function normalizeCheckboxToken(token: string): string {
  const raw = String(token || '').trim();
  if (/^\[[^\]\r\n]?\]$/.test(raw)) return raw;
  if (raw.length <= 1) return `[${raw || ' '}]`;
  return '';
}

function normalizeCheckboxMarker(value: string): string {
  const raw = String(value || '').trim();
  const tokenMatch = raw.match(/^\[([^\]\r\n]?)\]$/);
  return tokenMatch ? tokenMatch[1] || ' ' : raw.slice(0, 1);
}

function normalizeCompleteMarkers(markers: string[] | undefined): Set<string> {
  const values = Array.isArray(markers) && markers.length > 0 ? markers : ['x', 'X'];
  return new Set(values.map((marker) => normalizeCheckboxMarker(marker)).filter(Boolean));
}

function formatTaskLineDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  ].join(' ');
}

function formatTaskLineTimestamp(date: Date, format: string | undefined): string {
  const momentFactory = (globalThis as any)?.window?.moment || (globalThis as any)?.moment;
  if (typeof momentFactory === 'function') {
    try {
      return momentFactory(date).format(String(format || '').trim() || 'YYYY-MM-DD HH:mm:ss');
    } catch (_error) {
      return formatTaskLineDate(date);
    }
  }
  return formatTaskLineDate(date);
}

function normalizeInlineFieldKey(key: string): string {
  return String(key || '').trim().replace(/\s+/g, '');
}

function normalizeInlineTag(tag: string): string {
  return String(tag || '')
    .trim()
    .replace(/^#/, '')
    .replace(/[^A-Za-z0-9_/-]/g, '')
    .replace(/^\/+|\/+$/g, '');
}
