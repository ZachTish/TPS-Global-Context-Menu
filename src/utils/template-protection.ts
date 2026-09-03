export type TemplateProtectionInspection = 'protected' | 'unprotected' | 'unsafe';

type SourceLine = {
  start: number;
  end: number;
  textEnd: number;
  text: string;
};

type ParsedTagToken = {
  value: string | null;
  raw: string;
  start?: number;
  end?: number;
  precedingDelimiter?: number;
  followingDelimiter?: number;
};

type ParsedTagField = {
  state: TemplateProtectionInspection;
  kind: 'none' | 'scalar' | 'flow' | 'block';
  keyLineIndex: number;
  itemLineIndexes: number[];
  matchingItemIndexes: number[];
  flowTokens: ParsedTagToken[];
  flowPrefix: string;
  flowSuffix: string;
  lines: SourceLine[];
};

const DEFAULT_TEMPLATE_PROTECTION_TAG = 'template';
const VALID_TEMPLATE_TAG_PATTERN = /^[\p{L}\p{N}_/-]+$/u;

function resolveAutomaticMutationExclusionSource(settingsOrPatterns: unknown): string {
  if (typeof settingsOrPatterns === 'string') return settingsOrPatterns;
  if (!settingsOrPatterns || typeof settingsOrPatterns !== 'object') return '';
  const record = settingsOrPatterns as Record<string, unknown>;
  return String(record.frontmatterAutoWriteExclusions ?? '');
}

export function parseAutomaticMutationExclusionPatterns(settingsOrPatterns: unknown): string[] {
  const raw = resolveAutomaticMutationExclusionSource(settingsOrPatterns);
  if (!raw.trim()) return [];
  return raw
    .split(/\r?\n|,/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Return the exact YAML tag represented by an exclusion pattern. `tag:` is
 * the canonical spelling; a leading `#` is also unambiguous in this setting.
 */
export function parseAutomaticMutationTagExclusion(rawPattern: unknown): string | null {
  const pattern = String(rawPattern ?? '').trim();
  const lower = pattern.toLocaleLowerCase();
  const rawTag = lower.startsWith('tag:')
    ? pattern.slice(4).trim()
    : pattern.startsWith('#')
      ? pattern.slice(1).trim()
      : '';
  if (!rawTag) return null;
  const normalized = normalizeTemplateProtectionTag(rawTag);
  return normalized || null;
}

export function getAutomaticMutationTagExclusions(settingsOrPatterns: unknown): string[] {
  return Array.from(new Set(
    parseAutomaticMutationExclusionPatterns(settingsOrPatterns)
      .map((pattern) => parseAutomaticMutationTagExclusion(pattern))
      .filter((tag): tag is string => Boolean(tag)),
  ));
}

export function updateAutomaticMutationTagExclusion(
  settingsOrPatterns: unknown,
  rawTag: unknown,
  shouldExclude: boolean,
): string {
  const source = resolveAutomaticMutationExclusionSource(settingsOrPatterns);
  const tag = normalizeTemplateProtectionTag(rawTag);
  if (!tag) return source;
  const filtered = parseAutomaticMutationExclusionPatterns(source).filter((pattern) =>
    parseAutomaticMutationTagExclusion(pattern) !== tag);
  if (shouldExclude) filtered.push(`tag:${tag}`);
  return filtered.join('\n');
}

function normalizeAutomaticMutationPath(value: unknown): string {
  const segments = String(value ?? '')
    .trim()
    .replace(/\\/gu, '/')
    .split('/');
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized.join('/').toLocaleLowerCase();
}

function matchesAutomaticMutationWildcard(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/gu, '.*')}$`, 'i').test(value);
}

/** Preserve the existing path/name/regex exclusion language. */
export function matchesAutomaticMutationPathExclusion(
  pathValue: unknown,
  basenameValue: unknown,
  rawPattern: unknown,
): boolean {
  const pattern = String(rawPattern ?? '').trim();
  if (!pattern) return false;
  const lower = pattern.toLocaleLowerCase();
  if (lower.startsWith('tag:') || pattern.startsWith('#')) return false;

  const path = normalizeAutomaticMutationPath(pathValue);
  const basename = normalizeAutomaticMutationPath(basenameValue);
  if (lower.startsWith('re:')) {
    const source = pattern.slice(3).trim();
    if (!source) return false;
    try {
      const regex = new RegExp(source, 'i');
      return regex.test(path) || regex.test(basename);
    } catch {
      return false;
    }
  }
  if (lower.startsWith('name:')) {
    const target = normalizeAutomaticMutationPath(pattern.slice(5));
    return Boolean(target) && matchesAutomaticMutationWildcard(target, basename);
  }

  const rawTarget = lower.startsWith('path:') ? pattern.slice(5).trim() : pattern;
  const hasTrailingSlash = /[\\/]$/u.test(rawTarget);
  const target = normalizeAutomaticMutationPath(rawTarget);
  if (!target) return false;
  if (target.includes('*')) {
    return matchesAutomaticMutationWildcard(target, path)
      || matchesAutomaticMutationWildcard(target, basename);
  }
  if (hasTrailingSlash) return path === target || path.startsWith(`${target}/`);
  return path === target || path.startsWith(`${target}/`) || basename === target;
}

export function normalizeTemplateProtectionTag(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .replace(/^#+/u, '')
    .trim()
    .toLocaleLowerCase();
  return normalized && VALID_TEMPLATE_TAG_PATTERN.test(normalized) ? normalized : '';
}

export function resolveTemplateProtectionTag(settings: unknown): string {
  const record = settings && typeof settings === 'object'
    ? settings as Record<string, unknown>
    : {};
  const configured = Object.prototype.hasOwnProperty.call(record, 'templateIdentificationTag')
    ? record.templateIdentificationTag
    : DEFAULT_TEMPLATE_PROTECTION_TAG;
  return normalizeTemplateProtectionTag(configured);
}

function normalizeCandidateTag(value: string): string {
  return normalizeTemplateProtectionTag(value);
}

function inspectTagValue(value: unknown, marker: string): TemplateProtectionInspection {
  if (value === null || value === undefined || value === '') return 'unprotected';
  const values = Array.isArray(value) ? value : [value];
  for (const entry of values) {
    if (entry === null || entry === undefined || entry === '') continue;
    if (typeof entry !== 'string') return 'unsafe';
    if (normalizeCandidateTag(entry) === marker) return 'protected';
  }
  return 'unprotected';
}

function findTagsKeys(frontmatter: Record<string, unknown>): string[] {
  return Object.keys(frontmatter).filter((key) => key.trim().toLocaleLowerCase() === 'tags');
}

export function inspectTemplateProtectionFrontmatter(
  frontmatter: unknown,
  settingsOrMarker: unknown,
): TemplateProtectionInspection {
  const marker = typeof settingsOrMarker === 'string'
    ? normalizeTemplateProtectionTag(settingsOrMarker)
    : resolveTemplateProtectionTag(settingsOrMarker);
  if (!marker) return 'unprotected';
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return 'unprotected';
  const record = frontmatter as Record<string, unknown>;
  const keys = findTagsKeys(record);
  if (keys.length === 0) return 'unprotected';
  if (keys.length > 1) return 'unsafe';
  return inspectTagValue(record[keys[0]], marker);
}

export function canAutomaticallyMutateTemplateFrontmatter(
  frontmatter: unknown,
  settingsOrPatterns: unknown,
): boolean {
  return inspectAutomaticMutationTagExclusionsFrontmatter(frontmatter, settingsOrPatterns) === 'unprotected';
}

export function inspectAutomaticMutationTagExclusionsFrontmatter(
  frontmatter: unknown,
  settingsOrPatterns: unknown,
): TemplateProtectionInspection {
  const markers = getAutomaticMutationTagExclusions(settingsOrPatterns);
  if (markers.length === 0) return 'unprotected';
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return 'unsafe';
  let sawUnsafe = false;
  for (const marker of markers) {
    const state = inspectTemplateProtectionFrontmatter(frontmatter, marker);
    if (state === 'protected') return 'protected';
    if (state === 'unsafe') sawUnsafe = true;
  }
  return sawUnsafe ? 'unsafe' : 'unprotected';
}

export function removeTemplateProtectionTagFromFrontmatter(
  frontmatter: unknown,
  settingsOrMarker: unknown,
): boolean {
  const marker = typeof settingsOrMarker === 'string'
    ? normalizeTemplateProtectionTag(settingsOrMarker)
    : resolveTemplateProtectionTag(settingsOrMarker);
  if (!marker || !frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return false;
  const record = frontmatter as Record<string, unknown>;
  const keys = findTagsKeys(record);
  if (keys.length !== 1) return false;
  const key = keys[0];
  const value = record[key];
  if (typeof value === 'string') {
    if (normalizeCandidateTag(value) !== marker) return false;
    delete record[key];
    return true;
  }
  if (!Array.isArray(value)) return false;
  if (value.some((entry) => entry !== null && entry !== undefined && typeof entry !== 'string')) return false;
  const filtered = value.filter((entry) => (
    typeof entry !== 'string' || normalizeCandidateTag(entry) !== marker
  ));
  if (filtered.length === value.length) return false;
  if (filtered.length === 0) delete record[key];
  else record[key] = filtered;
  return true;
}

function splitSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    let textEnd = cursor;
    while (textEnd < source.length && source[textEnd] !== '\n' && source[textEnd] !== '\r') textEnd += 1;
    let end = textEnd;
    if (source[end] === '\r' && source[end + 1] === '\n') end += 2;
    else if (source[end] === '\r' || source[end] === '\n') end += 1;
    lines.push({
      start: cursor,
      end,
      textEnd,
      text: source.slice(cursor, textEnd),
    });
    cursor = end;
  }
  if (source.length === 0) return [];
  return lines;
}

function findUnquotedColon(value: string): number {
  let quote: 'single' | 'double' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote === 'single') {
      if (char === "'" && value[index + 1] === "'") index += 1;
      else if (char === "'") quote = null;
      continue;
    }
    if (quote === 'double') {
      if (char === '\\') index += 1;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "'") quote = 'single';
    else if (char === '"') quote = 'double';
    else if (char === ':') return index;
  }
  return -1;
}

function parseKeyToken(raw: string): string | null {
  const token = raw.trim();
  if (!token) return null;
  if (token.startsWith("'") && token.endsWith("'")) {
    return token.slice(1, -1).replace(/''/gu, "'");
  }
  if (token.startsWith('"') && token.endsWith('"')) {
    try {
      const parsed = JSON.parse(token);
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }
  return token;
}

function parseTopLevelKey(line: string): { key: string; colonIndex: number } | null {
  if (!line || /^[\s#%]/u.test(line)) return null;
  const colonIndex = findUnquotedColon(line);
  if (colonIndex <= 0) return null;
  const key = parseKeyToken(line.slice(0, colonIndex));
  return key ? { key, colonIndex } : null;
}

function stripInlineComment(raw: string): { value: string; suffix: string } | null {
  let quote: 'single' | 'double' | null = null;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote === 'single') {
      if (char === "'" && raw[index + 1] === "'") index += 1;
      else if (char === "'") quote = null;
      continue;
    }
    if (quote === 'double') {
      if (char === '\\') index += 1;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "'") quote = 'single';
    else if (char === '"') quote = 'double';
    else if (char === '#' && (index === 0 || /\s/u.test(raw[index - 1]))) {
      return { value: raw.slice(0, index).trim(), suffix: raw.slice(index) };
    }
  }
  if (quote) return null;
  return { value: raw.trim(), suffix: '' };
}

function parseScalarToken(raw: string): ParsedTagToken | null {
  const split = stripInlineComment(raw);
  if (!split) return null;
  const token = split.value;
  if (!token) return { value: null, raw };
  if (token.startsWith("'")) {
    if (!token.endsWith("'") || token.length < 2) return null;
    return { value: token.slice(1, -1).replace(/''/gu, "'"), raw };
  }
  if (token.startsWith('"')) {
    if (!token.endsWith('"') || token.length < 2) return null;
    try {
      const parsed = JSON.parse(token);
      return typeof parsed === 'string' ? { value: parsed, raw } : null;
    } catch {
      return null;
    }
  }
  if (/^[&*!|>{}\[\]]/u.test(token) || /[{}\[\]]/u.test(token)) return null;
  if (/^(?:null|~)$/iu.test(token)) return { value: null, raw };
  return { value: token, raw };
}

function parseFlowTokens(raw: string): {
  tokens: ParsedTagToken[];
  prefix: string;
  suffix: string;
} | null {
  const openIndex = raw.indexOf('[');
  if (openIndex < 0) return null;
  let quote: 'single' | 'double' | null = null;
  let closeIndex = -1;
  const commaIndexes: number[] = [];
  for (let index = openIndex + 1; index < raw.length; index += 1) {
    const char = raw[index];
    if (quote === 'single') {
      if (char === "'" && raw[index + 1] === "'") index += 1;
      else if (char === "'") quote = null;
      continue;
    }
    if (quote === 'double') {
      if (char === '\\') index += 1;
      else if (char === '"') quote = null;
      continue;
    }
    if (char === "'") quote = 'single';
    else if (char === '"') quote = 'double';
    else if (char === ',') commaIndexes.push(index);
    else if (char === ']') {
      closeIndex = index;
      break;
    }
  }
  if (quote || closeIndex < 0) return null;
  const trailing = raw.slice(closeIndex + 1);
  if (trailing.trim() && !/^\s*#/u.test(trailing)) return null;
  const boundaries = [openIndex, ...commaIndexes.filter((index) => index < closeIndex), closeIndex];
  const tokens: ParsedTagToken[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index] + 1;
    const end = boundaries[index + 1];
    const tokenRaw = raw.slice(start, end);
    if (!tokenRaw.trim()) {
      if (boundaries.length === 2) continue;
      return null;
    }
    const token = parseScalarToken(tokenRaw);
    if (!token || token.value === null) return null;
    tokens.push({
      ...token,
      start,
      end,
      precedingDelimiter: boundaries[index],
      followingDelimiter: boundaries[index + 1] < closeIndex
        ? boundaries[index + 1]
        : undefined,
    });
  }
  return {
    tokens,
    prefix: raw.slice(0, openIndex),
    suffix: raw.slice(closeIndex + 1),
  };
}

function emptyParsedTagField(lines: SourceLine[], state: TemplateProtectionInspection): ParsedTagField {
  return {
    state,
    kind: 'none',
    keyLineIndex: -1,
    itemLineIndexes: [],
    matchingItemIndexes: [],
    flowTokens: [],
    flowPrefix: '',
    flowSuffix: '',
    lines,
  };
}

function parseTemplateTagField(source: string, marker: string): ParsedTagField {
  const lines = splitSourceLines(source);
  if (!marker) return emptyParsedTagField(lines, 'unprotected');
  if (lines.length === 0) return emptyParsedTagField(lines, 'unprotected');

  const firstText = lines[0].text.replace(/^\uFEFF/u, '');
  if (!/^---[ \t]*$/u.test(firstText)) {
    if (firstText.trim() === '---') return emptyParsedTagField(lines, 'unsafe');
    const firstMeaningfulIndex = lines.findIndex((line) => line.text.trim().length > 0);
    if (firstMeaningfulIndex > 0 && lines[firstMeaningfulIndex].text.trim() === '---') {
      return emptyParsedTagField(lines, 'unsafe');
    }
    return emptyParsedTagField(lines, 'unprotected');
  }

  let closeIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    // YAML document delimiters must begin at column zero. Indented delimiter-like
    // text is valid content inside a block scalar and must not truncate inspection.
    if (/^(?:---|\.\.\.)[ \t]*$/u.test(lines[index].text)) {
      closeIndex = index;
      break;
    }
  }
  if (closeIndex < 0) return emptyParsedTagField(lines, 'unsafe');

  const topLevelKeys: Array<{ index: number; key: string; colonIndex: number }> = [];
  for (let index = 1; index < closeIndex; index += 1) {
    const parsed = parseTopLevelKey(lines[index].text);
    if (parsed) topLevelKeys.push({ index, ...parsed });
  }
  const tagKeys = topLevelKeys.filter((entry) => entry.key.trim().toLocaleLowerCase() === 'tags');
  if (tagKeys.length === 0) return emptyParsedTagField(lines, 'unprotected');
  if (tagKeys.length > 1) return emptyParsedTagField(lines, 'unsafe');

  const tagKey = tagKeys[0];
  const nextKey = topLevelKeys.find((entry) => entry.index > tagKey.index);
  const fieldEnd = nextKey?.index ?? closeIndex;
  const remainder = lines[tagKey.index].text.slice(tagKey.colonIndex + 1);
  const scalarRemainder = stripInlineComment(remainder);
  if (!scalarRemainder) return emptyParsedTagField(lines, 'unsafe');

  if (scalarRemainder.value.startsWith('[')) {
    const flow = parseFlowTokens(remainder);
    if (!flow) return emptyParsedTagField(lines, 'unsafe');
    const matchingItemIndexes = flow.tokens
      .map((token, index) => normalizeCandidateTag(token.value ?? '') === marker ? index : -1)
      .filter((index) => index >= 0);
    return {
      state: matchingItemIndexes.length ? 'protected' : 'unprotected',
      kind: 'flow',
      keyLineIndex: tagKey.index,
      itemLineIndexes: [],
      matchingItemIndexes,
      flowTokens: flow.tokens,
      flowPrefix: `${lines[tagKey.index].text.slice(0, tagKey.colonIndex + 1)}${flow.prefix}`,
      flowSuffix: flow.suffix,
      lines,
    };
  }

  if (scalarRemainder.value) {
    const scalar = parseScalarToken(remainder);
    if (!scalar || scalar.value === null) return emptyParsedTagField(lines, 'unsafe');
    const matches = normalizeCandidateTag(scalar.value) === marker;
    return {
      state: matches ? 'protected' : 'unprotected',
      kind: 'scalar',
      keyLineIndex: tagKey.index,
      itemLineIndexes: [],
      matchingItemIndexes: matches ? [0] : [],
      flowTokens: [scalar],
      flowPrefix: '',
      flowSuffix: '',
      lines,
    };
  }

  const itemLineIndexes: number[] = [];
  const matchingItemIndexes: number[] = [];
  for (let index = tagKey.index + 1; index < fieldEnd; index += 1) {
    const text = lines[index].text;
    if (!text.trim() || /^\s*#/u.test(text)) continue;
    const match = text.match(/^\s+-\s+(.+)$/u);
    if (!match) return emptyParsedTagField(lines, 'unsafe');
    const scalar = parseScalarToken(match[1]);
    if (!scalar || scalar.value === null) return emptyParsedTagField(lines, 'unsafe');
    const itemIndex = itemLineIndexes.length;
    itemLineIndexes.push(index);
    if (normalizeCandidateTag(scalar.value) === marker) matchingItemIndexes.push(itemIndex);
  }
  return {
    state: matchingItemIndexes.length ? 'protected' : 'unprotected',
    kind: 'block',
    keyLineIndex: tagKey.index,
    itemLineIndexes,
    matchingItemIndexes,
    flowTokens: [],
    flowPrefix: '',
    flowSuffix: '',
    lines,
  };
}

export function inspectTemplateProtectionSource(
  source: string,
  settingsOrMarker: unknown,
): TemplateProtectionInspection {
  const marker = typeof settingsOrMarker === 'string'
    ? normalizeTemplateProtectionTag(settingsOrMarker)
    : resolveTemplateProtectionTag(settingsOrMarker);
  return parseTemplateTagField(String(source ?? ''), marker).state;
}

export function inspectAutomaticMutationTagExclusionsSource(
  source: string,
  settingsOrPatterns: unknown,
): TemplateProtectionInspection {
  const markers = getAutomaticMutationTagExclusions(settingsOrPatterns);
  if (markers.length === 0) return 'unprotected';
  let sawUnsafe = false;
  for (const marker of markers) {
    const state = inspectTemplateProtectionSource(source, marker);
    if (state === 'protected') return 'protected';
    if (state === 'unsafe') sawUnsafe = true;
  }
  return sawUnsafe ? 'unsafe' : 'unprotected';
}

export function canAutomaticallyMutateTemplateSource(source: string, settingsOrPatterns: unknown): boolean {
  return inspectAutomaticMutationTagExclusionsSource(source, settingsOrPatterns) === 'unprotected';
}

function removeLineRanges(source: string, lines: SourceLine[], indexes: Set<number>): string {
  if (indexes.size === 0) return source;
  let output = '';
  for (let index = 0; index < lines.length; index += 1) {
    if (!indexes.has(index)) output += source.slice(lines[index].start, lines[index].end);
  }
  return output;
}

export function stripTemplateProtectionTagFromSource(source: string, settingsOrMarker: unknown): string {
  const raw = String(source ?? '');
  const marker = typeof settingsOrMarker === 'string'
    ? normalizeTemplateProtectionTag(settingsOrMarker)
    : resolveTemplateProtectionTag(settingsOrMarker);
  const parsed = parseTemplateTagField(raw, marker);
  if (parsed.state !== 'protected' || parsed.keyLineIndex < 0) return raw;

  if (parsed.kind === 'scalar') {
    return removeLineRanges(raw, parsed.lines, new Set([parsed.keyLineIndex]));
  }

  if (parsed.kind === 'block') {
    const removal = new Set<number>();
    for (const itemIndex of parsed.matchingItemIndexes) {
      const lineIndex = parsed.itemLineIndexes[itemIndex];
      if (lineIndex !== undefined) removal.add(lineIndex);
    }
    if (removal.size === parsed.itemLineIndexes.length) removal.add(parsed.keyLineIndex);
    return removeLineRanges(raw, parsed.lines, removal);
  }

  if (parsed.kind === 'flow') {
    const matching = new Set(parsed.matchingItemIndexes);
    if (matching.size === parsed.flowTokens.length) {
      return removeLineRanges(raw, parsed.lines, new Set([parsed.keyLineIndex]));
    }

    const removalRanges: Array<{ start: number; end: number }> = [];
    let matchingRunStart = -1;
    for (let index = 0; index <= parsed.flowTokens.length; index += 1) {
      if (index < parsed.flowTokens.length && matching.has(index)) {
        if (matchingRunStart < 0) matchingRunStart = index;
        continue;
      }
      if (matchingRunStart < 0) continue;

      const matchingRunEnd = index - 1;
      const firstToken = parsed.flowTokens[matchingRunStart];
      const lastToken = parsed.flowTokens[matchingRunEnd];
      if (firstToken.start !== undefined && lastToken.end !== undefined) {
        if (matchingRunEnd < parsed.flowTokens.length - 1 && lastToken.followingDelimiter !== undefined) {
          removalRanges.push({ start: firstToken.start, end: lastToken.followingDelimiter + 1 });
        } else if (firstToken.precedingDelimiter !== undefined) {
          removalRanges.push({ start: firstToken.precedingDelimiter, end: lastToken.end });
        }
      }
      matchingRunStart = -1;
    }

    const line = parsed.lines[parsed.keyLineIndex];
    let replacement = line.text;
    const colonIndex = findUnquotedColon(replacement);
    const remainderOffset = colonIndex + 1;
    for (const range of removalRanges.reverse()) {
      replacement = `${replacement.slice(0, remainderOffset + range.start)}${replacement.slice(remainderOffset + range.end)}`;
    }
    return `${raw.slice(0, line.start)}${replacement}${raw.slice(line.textEnd)}`;
  }

  return raw;
}

export async function canAutomaticallyMutateTemplateFile(
  vault: {
    read?: (file: unknown) => Promise<string>;
    cachedRead?: (file: unknown) => Promise<string>;
  } | null | undefined,
  file: unknown,
  settingsOrPatterns: unknown,
): Promise<boolean> {
  return canAutomaticallyMutateFileWithExclusions(vault, file, settingsOrPatterns);
}

export function canAutomaticallyMutatePathWithExclusions(
  file: unknown,
  settingsOrPatterns: unknown,
): boolean {
  const patterns = parseAutomaticMutationExclusionPatterns(settingsOrPatterns);
  if (patterns.length === 0) return true;
  const record = file && typeof file === 'object'
    ? file as Record<string, unknown>
    : {};
  const path = String(record.path ?? '');
  const name = String(record.name ?? path.split('/').pop() ?? '');
  const basename = String(record.basename ?? name.replace(/\.[^.]+$/u, ''));
  return !patterns.some((pattern) => matchesAutomaticMutationPathExclusion(path, basename, pattern));
}

export async function canAutomaticallyMutateFileWithExclusions(
  vault: {
    read?: (file: unknown) => Promise<string>;
    cachedRead?: (file: unknown) => Promise<string>;
  } | null | undefined,
  file: unknown,
  settingsOrPatterns: unknown,
): Promise<boolean> {
  const patterns = parseAutomaticMutationExclusionPatterns(settingsOrPatterns);
  if (patterns.length === 0) return true;
  if (!canAutomaticallyMutatePathWithExclusions(file, patterns.join('\n'))) return false;
  if (getAutomaticMutationTagExclusions(patterns.join('\n')).length === 0) return true;

  const read = typeof vault?.read === 'function'
    ? vault.read.bind(vault)
    : typeof vault?.cachedRead === 'function'
      ? vault.cachedRead.bind(vault)
      : null;
  if (!read) return false;
  try {
    const source = await read(file);
    return canAutomaticallyMutateTemplateSource(source, patterns.join('\n'));
  } catch {
    return false;
  }
}
