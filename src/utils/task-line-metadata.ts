const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([^\]\r\n]?)\](\s*)(.*)$/;
const TAG_GLOBAL_RE = /(?:^|\s)(#[A-Za-z0-9_/-]+)/g;
const TPS_INLINE_METADATA_RE = /\s*(?:\[(?:tpsInlineProps|tps-inline-props)\s*::\s*[^\]]+\]|%%\s*tps-inline-props\s*:[\s\S]*?%%|<!--\s*tps-inline-props\s*:[\s\S]*?-->|<span\b[^>]*data-tps-inline-props\s*=\s*(?:"[^"]*"|'[^']*')[^>]*>\s*<\/span>|\[\^\s*tps-inline:[^\]]+\](?::\s*\S+)?)\s*/gi;

export const TASK_ASSOCIATED_NOTE_PATH_KEY = 'associatedNotePath';

export interface ParsedTaskLine {
  prefix: string;
  marker: string;
  token: string;
  body: string;
}

export const TASK_COMPLETED_DATE_FIELD = 'completedDate';

export interface TaskLineTimestampOptions {
  enabled?: boolean;
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
  return getPlainTaskTitle(getTaskSourceTitle(line));
}

export function getTaskSourceTitle(line: string): string {
  const parsed = parseTaskLine(line);
  if (!parsed) return '';
  return stripTaskMetadata(parsed.body);
}

export interface ParsedTaskTitleLink {
  targetPath: string;
  displayTitle: string;
}

export function parseTaskTitleLink(rawTitle: string): ParsedTaskTitleLink | null {
  const title = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const leadingLink = parseLeadingTaskTitleLink(title);
  if (!leadingLink) return null;
  const targetPath = normalizeTaskAssociatedNotePath(leadingLink.rawTarget);
  if (!targetPath) return null;
  return {
    targetPath,
    displayTitle: leadingLink.displayTitle,
  };
}

export function getPlainTaskTitle(rawTitle: string): string {
  return unwrapTaskTitleLinks(String(rawTitle || ''))
    .replace(/\s+/g, ' ')
    .trim();
}

export function readTaskAssociatedNotePath(line: string): string {
  for (const block of getTaskInlinePropsJsonBlocks(line)) {
    const key = findCaseInsensitiveRecordKey(block.value, TASK_ASSOCIATED_NOTE_PATH_KEY);
    const path = key ? normalizeTaskAssociatedNotePath(block.value[key]) : '';
    if (path) return path;
  }
  return '';
}

export function setTaskAssociatedNotePath(line: string, path: string): string {
  const cleanPath = normalizeTaskAssociatedNotePath(path);
  if (!cleanPath) return line;
  if (readTaskAssociatedNotePath(line) === cleanPath) return line;

  const blocks = getTaskInlinePropsJsonBlocks(line);
  const target = blocks.find((block) => !!findCaseInsensitiveRecordKey(block.value, TASK_ASSOCIATED_NOTE_PATH_KEY))
    || blocks[0];
  if (target) {
    const existingKey = findCaseInsensitiveRecordKey(target.value, TASK_ASSOCIATED_NOTE_PATH_KEY);
    const value = Object.fromEntries(
      Object.entries(target.value).filter(([key]) => key.trim().toLowerCase() !== TASK_ASSOCIATED_NOTE_PATH_KEY.toLowerCase()),
    );
    value[existingKey || TASK_ASSOCIATED_NOTE_PATH_KEY] = cleanPath;
    const serialized = serializeTaskInlinePropsPayload(value, target.encoding);
    return `${line.slice(0, target.payloadStart)}${serialized}${line.slice(target.payloadEnd)}`;
  }

  return `${String(line || '').trimEnd()} %% tps-inline-props:${JSON.stringify({ [TASK_ASSOCIATED_NOTE_PATH_KEY]: cleanPath })} %%`.trimEnd();
}

export function normalizeTaskAssociatedNotePath(rawValue: unknown): string {
  let value = String(rawValue ?? '').trim();
  if (!value) return '';
  value = value.replace(/^["']|["']$/g, '').trim();

  const wikiLink = value.match(/^!?\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]*)?\]\]$/u);
  if (wikiLink) value = String(wikiLink[1] || '').trim();
  const markdownLink = value.match(/^\[[^\]]+\]\(([^)]+)\)$/u);
  if (markdownLink) value = String(markdownLink[1] || '').trim();

  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1).trim();
  if (!value || isExternalTaskLinkTarget(value)) return '';
  try {
    value = decodeURIComponent(value);
  } catch {
    // Preserve a literal vault path containing malformed percent escapes.
  }
  if (!value || isExternalTaskLinkTarget(value)) return '';
  return value
    .split('#', 1)[0]
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .trim();
}

export function getTaskEditableBody(line: string): string {
  return parseTaskLine(line)?.body ?? '';
}

export function setTaskEditableBody(line: string, body: string): string {
  const parsed = parseTaskLine(line);
  if (!parsed) return line;
  const sourceAssociation = resolveTaskAssociationForEdit(line, body);
  const cleanBody = String(body || '').replace(/\r?\n/g, ' ').trim();
  if (!cleanBody) return line;
  const editableLine = `${parsed.prefix}${parsed.token} ${cleanBody}`.trimEnd();
  const editableTitle = getTaskSourceTitle(editableLine);
  const normalizedTitle = normalizeLeadingLinkedTaskTitle(editableTitle);
  let nextLine = editableTitle && normalizedTitle !== editableTitle
    ? replaceTaskTitlePreservingMetadata(editableLine, normalizedTitle)
    : editableLine;
  for (const metadata of extractProtectedTaskIdentityMetadata(parsed.body)) {
    if (!nextLine.includes(metadata)) nextLine = `${nextLine.trimEnd()} ${metadata}`;
  }
  if (sourceAssociation) nextLine = setTaskAssociatedNotePath(nextLine, sourceAssociation);
  return nextLine;
}

export function setTaskCheckboxToken(line: string, token: string): string {
  const normalizedToken = normalizeCheckboxToken(token);
  if (!normalizedToken) return line;
  return String(line || '').replace(TASK_LINE_RE, (_match, prefix: string, _marker: string, _gap: string, body: string) => {
    return `${prefix}${normalizedToken} ${String(body || '').trimStart()}`.trimEnd();
  });
}

export function convertTaskLineToBullet(line: string): string {
  const withoutCompletedDate = setInlineFieldValueOnTaskLine(line, TASK_COMPLETED_DATE_FIELD, null);
  const parsed = parseTaskLine(withoutCompletedDate);
  if (!parsed) return line;
  return `${parsed.prefix}${parsed.body}`.trimEnd();
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
  if (options.enabled === false) return line;
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
  const cleanTitle = normalizeLeadingLinkedTaskTitle(title);
  if (!cleanTitle) return line;
  const association = resolveTaskAssociationForEdit(line, title);
  let nextLine = replaceTaskTitlePreservingMetadata(line, cleanTitle);
  if (association) nextLine = setTaskAssociatedNotePath(nextLine, association);
  return nextLine;
}

export function readInlineFieldValue(line: string, key: string): string {
  const body = parseTaskLine(line)?.body ?? String(line || '');
  const normalizedKey = String(key || '').trim().toLowerCase();
  if (!normalizedKey) return '';
  for (const field of scanTaskInlineFields(body)) {
    if (field.key.toLowerCase() === normalizedKey) return field.value.trim();
  }
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
  const cleanLine = String(line || '').trim();
  if (!cleanLine) return content;
  const trimmed = String(content || '').replace(/\s+$/g, '');
  return trimmed ? `${trimmed}${newline}${cleanLine}${newline}` : `${cleanLine}${newline}`;
}

export function findAfterFrontmatterIndex(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') return i + 1;
  }
  return 0;
}

export function stripTaskMetadata(body: string): string {
  const source = String(body || '');
  return removeTaskTextRanges(source, getTaskMetadataRanges(source), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripTaskInlinePropsMetadata(value: string): string {
  TPS_INLINE_METADATA_RE.lastIndex = 0;
  const stripped = String(value || '').replace(TPS_INLINE_METADATA_RE, ' ');
  TPS_INLINE_METADATA_RE.lastIndex = 0;
  return stripped.replace(/[ \t]+$/gm, '').trimEnd();
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
  const source = String(body || '');
  const matches = scanTaskInlineFields(source)
    .filter((field) => field.key.toLowerCase() === normalizedKey);
  return removeTaskTextRanges(source, matches, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractTaskMetadata(body: string): string[] {
  const source = String(body || '');
  return getTaskMetadataRanges(source)
    .map((range) => source.slice(range.start, range.end).trim())
    .filter(Boolean);
}

function extractTpsInlineMetadata(body: string): string[] {
  const source = String(body || '');
  return getTaskInlinePropsMetadataRanges(source)
    .map((range) => source.slice(range.start, range.end).trim())
    .filter(Boolean);
}

function extractProtectedTaskIdentityMetadata(body: string): string[] {
  const source = String(body || '');
  const ranges: TaskTextRange[] = [
    ...scanTaskInlineFields(source).filter((field) => ['tpsid', 'subitemid'].includes(field.key.toLowerCase())),
    ...getTaskInlinePropsMetadataRanges(source),
  ];
  return normalizeTaskTextRanges(ranges)
    .map((range) => source.slice(range.start, range.end).trim())
    .filter(Boolean);
}

type TaskTextRange = {
  start: number;
  end: number;
};

type TaskInlineFieldRange = TaskTextRange & {
  key: string;
  value: string;
};

function scanTaskInlineFields(value: string): TaskInlineFieldRange[] {
  const source = String(value || '');
  const fields: TaskInlineFieldRange[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const open = source[index];
    if (open !== '[' && open !== '(') continue;
    if (index > 0 && !/\s/u.test(source[index - 1] || '')) continue;

    const close = open === '[' ? ']' : ')';
    let cursor = index + 1;
    while (/\s/u.test(source[cursor] || '')) cursor += 1;
    const keyStart = cursor;
    while (/[A-Za-z0-9_.-]/u.test(source[cursor] || '')) cursor += 1;
    const key = source.slice(keyStart, cursor);
    if (!key) continue;
    while (/\s/u.test(source[cursor] || '')) cursor += 1;
    if (source.slice(cursor, cursor + 2) !== '::') continue;
    cursor += 2;
    const valueStart = cursor;
    let depth = 1;
    let end = -1;
    for (; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (character === '\\') {
        cursor += 1;
        continue;
      }
      if (character === open) {
        depth += 1;
        continue;
      }
      if (character !== close) continue;
      depth -= 1;
      if (depth === 0) {
        end = cursor + 1;
        break;
      }
    }
    if (end < 0) continue;
    fields.push({
      start: index,
      end,
      key,
      value: source.slice(valueStart, end - 1).trim(),
    });
    index = end - 1;
  }
  return fields;
}

function getTaskMetadataRanges(value: string): TaskTextRange[] {
  const source = String(value || '');
  const hidden = getTaskInlinePropsMetadataRanges(source);
  const fields = scanTaskInlineFields(source)
    .filter((field) => !['tpsinlineprops', 'tps-inline-props'].includes(field.key.toLowerCase()));
  const tags = getTaskTagRanges(source);
  return normalizeTaskTextRanges([...hidden, ...fields, ...tags]);
}

function getTaskInlinePropsMetadataRanges(value: string): TaskTextRange[] {
  const source = String(value || '');
  const ranges: TaskTextRange[] = [];
  TPS_INLINE_METADATA_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TPS_INLINE_METADATA_RE.exec(source)) !== null) {
    ranges.push({ start: match.index, end: match.index + String(match[0] || '').length });
  }
  TPS_INLINE_METADATA_RE.lastIndex = 0;
  return ranges;
}

function getTaskTagRanges(value: string): TaskTextRange[] {
  const source = String(value || '');
  const ranges: TaskTextRange[] = [];
  TAG_GLOBAL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_GLOBAL_RE.exec(source)) !== null) {
    const raw = String(match[0] || '');
    const tag = String(match[1] || '');
    const offset = raw.lastIndexOf(tag);
    const start = match.index + Math.max(0, offset);
    ranges.push({ start, end: start + tag.length });
  }
  TAG_GLOBAL_RE.lastIndex = 0;
  return ranges;
}

function normalizeTaskTextRanges(ranges: TaskTextRange[]): TaskTextRange[] {
  const sorted = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const output: TaskTextRange[] = [];
  for (const range of sorted) {
    const previous = output[output.length - 1];
    if (previous && range.start < previous.end) {
      if (range.end > previous.end) previous.end = range.end;
      continue;
    }
    output.push({ start: range.start, end: range.end });
  }
  return output;
}

function removeTaskTextRanges(value: string, ranges: TaskTextRange[], replacement = ''): string {
  const source = String(value || '');
  const normalized = normalizeTaskTextRanges(ranges);
  if (!normalized.length) return source;
  let cursor = 0;
  let output = '';
  for (const range of normalized) {
    output += source.slice(cursor, range.start);
    output += replacement;
    cursor = range.end;
  }
  return `${output}${source.slice(cursor)}`;
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

type TaskInlinePropsJsonBlock = {
  payloadStart: number;
  payloadEnd: number;
  value: Record<string, unknown>;
  encoding: TaskInlinePropsEncoding;
};

type TaskInlinePropsEncoding = 'json' | 'uri-json' | 'html-json';

type TaskInlinePropsCarrier = {
  pattern: RegExp;
  payloadGroup: number;
};

function getTaskInlinePropsJsonBlocks(line: string): TaskInlinePropsJsonBlock[] {
  const source = String(line || '');
  const blocks: TaskInlinePropsJsonBlock[] = [];
  const carriers: TaskInlinePropsCarrier[] = [
    { pattern: /%%\s*tps-inline-props\s*:\s*([\s\S]*?)\s*%%/giu, payloadGroup: 1 },
    { pattern: /<!--\s*tps-inline-props\s*:\s*([\s\S]*?)\s*-->/giu, payloadGroup: 1 },
    { pattern: /\[(?:tpsInlineProps|tps-inline-props)\s*::\s*([^\]]+)\]/giu, payloadGroup: 1 },
    { pattern: /\bdata-tps-inline-props\s*=\s*(["'])([\s\S]*?)\1/giu, payloadGroup: 2 },
  ];
  for (const { pattern, payloadGroup } of carriers) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const rawPayload = String(match[payloadGroup] || '');
      const parsed = parseTaskInlinePropsPayload(rawPayload);
      if (!parsed) continue;
      const payloadOffset = match[0].indexOf(rawPayload);
      if (payloadOffset < 0) continue;
      const payloadStart = (match.index || 0) + payloadOffset;
      blocks.push({
        payloadStart,
        payloadEnd: payloadStart + rawPayload.length,
        value: parsed.value,
        encoding: parsed.encoding,
      });
    }
    pattern.lastIndex = 0;
  }
  return blocks.sort((a, b) => a.payloadStart - b.payloadStart);
}

function parseTaskInlinePropsPayload(rawPayload: string): { value: Record<string, unknown>; encoding: TaskInlinePropsEncoding } | null {
  const raw = String(rawPayload || '').trim();
  if (!raw) return null;
  const direct = parseJsonRecord(raw);
  if (direct) return { value: direct, encoding: 'json' };

  const htmlDecoded = decodeTaskInlinePropsHtml(raw);
  if (htmlDecoded !== raw) {
    const htmlRecord = parseJsonRecord(htmlDecoded);
    if (htmlRecord) return { value: htmlRecord, encoding: 'html-json' };
  }

  let decoded = htmlDecoded;
  for (let index = 0; index < 2; index += 1) {
    let next = decoded;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) return null;
    const uriRecord = parseJsonRecord(next);
    if (uriRecord) return { value: uriRecord, encoding: 'uri-json' };
    decoded = next;
  }
  return null;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function serializeTaskInlinePropsPayload(value: Record<string, unknown>, encoding: TaskInlinePropsEncoding): string {
  const json = JSON.stringify(value);
  if (encoding === 'uri-json') return encodeURIComponent(json);
  if (encoding === 'html-json') return encodeTaskInlinePropsHtml(json);
  return json;
}

function decodeTaskInlinePropsHtml(value: string): string {
  return String(value || '')
    .replace(/&quot;|&#34;|&#x22;/giu, '"')
    .replace(/&#39;|&#x27;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&amp;/giu, '&');
}

function encodeTaskInlinePropsHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function findCaseInsensitiveRecordKey(value: Record<string, unknown>, key: string): string {
  const wanted = String(key || '').trim().toLowerCase();
  return Object.keys(value || {}).find((candidate) => candidate.trim().toLowerCase() === wanted) || '';
}

function replaceTaskTitlePreservingMetadata(line: string, title: string): string {
  const parsed = parseTaskLine(line);
  if (!parsed) return line;
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  if (!cleanTitle) return line;
  const metadata = extractTaskMetadata(parsed.body);
  return `${parsed.prefix}${parsed.token} ${cleanTitle}${metadata.length ? ` ${metadata.join(' ')}` : ''}`.trimEnd();
}

function resolveTaskAssociationForEdit(line: string, nextTitleOrBody: string): string {
  const stored = readTaskAssociatedNotePath(line);
  if (stored) return stored;
  const sourceLegacy = parseTaskTitleLink(getTaskSourceTitle(line))?.targetPath || '';
  if (sourceLegacy) return sourceLegacy;
  const candidate = String(nextTitleOrBody || '').replace(/\r?\n/g, ' ').trim();
  if (!candidate) return '';
  const candidateLine = parseTaskLine(candidate) ? candidate : `- [ ] ${candidate}`;
  return parseTaskTitleLink(getTaskSourceTitle(candidateLine))?.targetPath || '';
}

function normalizeLeadingLinkedTaskTitle(value: string): string {
  const title = String(value || '').replace(/\s+/g, ' ').trim();
  if (!title) return '';
  return parseLeadingTaskTitleLink(title)?.displayTitle || title;
}

function unwrapTaskTitleLinks(value: string): string {
  const withoutWikiLinks = String(value || '').replace(/!?\[\[([^\]]+)\]\]/gu, (_raw, innerValue: string) => {
    const inner = String(innerValue || '').trim();
    const pipeIndex = inner.indexOf('|');
    const target = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim();
    const alias = (pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : '').trim();
    return alias || taskLinkTargetBasename(target);
  });
  return unwrapTaskMarkdownLinks(withoutWikiLinks);
}

type ParsedTaskMarkdownLink = {
  label: string;
  target: string;
  end: number;
};

function unwrapTaskMarkdownLinks(value: string): string {
  const source = String(value || '');
  let output = '';
  let cursor = 0;
  while (cursor < source.length) {
    const link = parseTaskMarkdownLinkAt(source, cursor);
    if (!link) {
      output += source[cursor] || '';
      cursor += 1;
      continue;
    }
    output += link.label.trim() || taskLinkTargetBasename(link.target);
    cursor = link.end;
  }
  return output;
}

function parseTaskMarkdownLinkAt(value: string, start: number): ParsedTaskMarkdownLink | null {
  const source = String(value || '');
  let labelStart = start;
  if (source[labelStart] === '!') labelStart += 1;
  if (source[labelStart] !== '[' || source[labelStart + 1] === '[') return null;
  const labelEnd = findMatchingTaskDelimiter(source, labelStart, '[', ']');
  if (labelEnd < 0 || source[labelEnd + 1] !== '(') return null;
  const targetStart = labelEnd + 1;
  const targetEnd = findMatchingTaskDelimiter(source, targetStart, '(', ')');
  if (targetEnd < 0) return null;
  return {
    label: source.slice(labelStart + 1, labelEnd),
    target: source.slice(targetStart + 1, targetEnd).trim(),
    end: targetEnd + 1,
  };
}

function findMatchingTaskDelimiter(
  value: string,
  start: number,
  open: string,
  close: string,
): number {
  const source = String(value || '');
  if (source[start] !== open) return -1;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close) depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

type LeadingTaskTitleLink = {
  rawTarget: string;
  displayTitle: string;
};

function parseLeadingTaskTitleLink(rawTitle: string): LeadingTaskTitleLink | null {
  const title = String(rawTitle || '').replace(/\s+/g, ' ').trim();
  if (!title) return null;

  const wikiMatch = title.match(/^!?\[\[([^\]]+)\]\](?:\s+([\s\S]+))?$/u);
  if (wikiMatch) {
    const inner = String(wikiMatch[1] || '').trim();
    const pipeIndex = inner.indexOf('|');
    const rawTarget = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim();
    const alias = (pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : '').trim();
    const label = alias || taskLinkTargetBasename(rawTarget);
    return {
      rawTarget,
      displayTitle: joinTaskTitleParts(label, wikiMatch[2]),
    };
  }

  const markdownLink = parseTaskMarkdownLinkAt(title, 0);
  if (!markdownLink) return null;
  const remainder = title.slice(markdownLink.end);
  if (remainder && !/^\s/u.test(remainder)) return null;
  return {
    rawTarget: markdownLink.target,
    displayTitle: joinTaskTitleParts(markdownLink.label || taskLinkTargetBasename(markdownLink.target), remainder),
  };
}

function joinTaskTitleParts(label: unknown, trailing: unknown): string {
  return [String(label || '').trim(), String(trailing || '').trim()]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isExternalTaskLinkTarget(value: string): boolean {
  let target = String(value || '').trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  const isExternal = (candidate: string) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate) || candidate.startsWith('//');
  if (isExternal(target)) return true;
  try {
    target = decodeURIComponent(target);
  } catch {
    return false;
  }
  return isExternal(target);
}

function taskLinkTargetBasename(value: string): string {
  let target = String(value || '').trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  target = target.split('#')[0]?.trim() || '';
  try {
    target = decodeURIComponent(target);
  } catch {
    // Preserve literal link text with malformed escapes.
  }
  target = target.replace(/\.md$/i, '');
  return target.split('/').pop()?.trim() || target;
}
