import type { TFile } from 'obsidian';
import type {
  EntityIndexDimensionDefinition,
  EntityIndexLineKind,
  EntityIndexRecord,
  EntityIndexSource,
} from './entity-index-core';
import {
  appendLineBlockId,
  parseTaskLine,
  readInlineFieldValue,
  readLineBlockId,
  readSemanticInlineFieldRanges,
  stripLineBlockId,
  stripTaskInlinePropsMetadata,
} from '../utils/task-line-metadata';

const MARKDOWN_LINE_PREFIX_RE = /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+/u;
const MARKDOWN_HEADING_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(.+)$/u;
const TAG_RE = /(?:^|[ \t])(#[\p{L}\p{N}_/-]+)/gu;
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/u;

export interface LineEntityDescriptor {
  readonly id: string;
  readonly sourcePath: string;
  readonly lineNumber: number;
  readonly lineKind: EntityIndexLineKind;
  readonly rawLine: string;
  readonly blockId: string;
  readonly legacyIdentities: readonly LineEntityLegacyIdentity[];
}

export interface LineEntityLegacyIdentity {
  readonly key: 'tpsId' | 'subitemId';
  readonly value: string;
}

export interface LineEntityMaterializationResult {
  readonly content: string;
  readonly blockId: string;
  readonly lineNumber: number;
  readonly changed: boolean;
}

export interface LineEntityVault {
  process(
    file: TFile,
    fn: (data: string) => string,
  ): Promise<string>;
}

export type LineEntityBlockIdFactory = (existingIds: ReadonlySet<string>) => string;

export class LineEntityResolutionError extends Error {
  constructor(
    readonly code:
      | 'missing-descriptor'
      | 'stale-source'
      | 'duplicate-identity'
      | 'invalid-block-id',
    message: string,
  ) {
    super(message);
    this.name = 'LineEntityResolutionError';
  }
}

/**
 * Content-backed provider for line entities.
 *
 * It is deliberately dimension-agnostic. Any configured dimension may source
 * values from inline fields; Kind is just the dimension used by current entity
 * reference pickers. Lines without a configured inline dimension are omitted.
 */
export class LineEntitySourceProvider {
  private readonly descriptorsById = new Map<string, LineEntityDescriptor>();
  private readonly descriptorIdsByPath = new Map<string, Set<string>>();

  constructor(
    private readonly blockIdFactory: LineEntityBlockIdFactory = createLineEntityBlockId,
  ) {}

  reset(): void {
    this.descriptorsById.clear();
    this.descriptorIdsByPath.clear();
  }

  forgetFile(path: string): void {
    const identity = normalizePath(path);
    const ids = this.descriptorIdsByPath.get(identity);
    if (ids) {
      for (const id of ids) this.descriptorsById.delete(id);
    }
    this.descriptorIdsByPath.delete(identity);
  }

  scanFile(
    path: string,
    content: string,
    definitions: readonly EntityIndexDimensionDefinition[],
  ): readonly EntityIndexSource[] {
    const sourcePath = normalizeSourcePath(path);
    this.forgetFile(sourcePath);
    if (!sourcePath) return Object.freeze([]);

    const configuredKeys = new Set(
      (definitions || [])
        .flatMap((definition) => definition.propertyKeys || [])
        .map(normalizeLookupValue)
        .filter(Boolean),
    );
    if (configuredKeys.size === 0) return Object.freeze([]);

    const sources: EntityIndexSource[] = [];
    const descriptorIds = new Set<string>();
    const lines = splitContentLines(String(content || ''));
    const nativeBlockIdIndexes = collectNativeBlockIdIndexes(lines);
    let inFrontmatter = lines[0]?.text.trim() === '---';
    let fence: { character: string; length: number } | null = null;

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index].text;
      const trimmed = rawLine.trim();
      if (inFrontmatter) {
        if (index > 0 && (trimmed === '---' || trimmed === '...')) {
          inFrontmatter = false;
        }
        continue;
      }

      const fenceMatch = rawLine.match(FENCE_RE);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        if (!fence) {
          fence = { character: marker[0], length: marker.length };
        } else if (isValidFenceClose(rawLine, marker, fence)) {
          fence = null;
        }
        continue;
      }
      if (fence) continue;

      const lineKind = getLineEntityKind(rawLine);
      if (!lineKind) continue;
      const fields = readSemanticInlineFieldRanges(rawLine)
        .filter((field) => configuredKeys.has(normalizeLookupValue(field.key)));
      if (fields.length === 0) continue;

      const inlineProperties = Object.create(null) as Record<string, unknown>;
      for (const field of fields) {
        const existing = findCaseInsensitiveKey(inlineProperties, field.key);
        if (!existing) {
          inlineProperties[field.key] = field.value;
          continue;
        }
        const values = Array.isArray(inlineProperties[existing])
          ? [...inlineProperties[existing] as unknown[]]
          : [inlineProperties[existing]];
        values.push(field.value);
        inlineProperties[existing] = values;
      }

      const blockId = readLineBlockId(rawLine);
      if (
        blockId
        && (nativeBlockIdIndexes.get(normalizeLookupValue(blockId))?.length || 0) !== 1
      ) {
        continue;
      }
      const lineNumber = index + 1;
      const id = blockId
        ? readyLineEntityId(sourcePath, blockId)
        : provisionalLineEntityId(sourcePath, lineNumber, rawLine);
      const locatorKey = blockId
        ? readyLineEntityLocator(sourcePath, blockId)
        : provisionalLineEntityLocator(sourcePath, lineNumber, rawLine);
      const label = getLineEntityLabel(rawLine, lineKind) || `Line ${lineNumber}`;
      const descriptor: LineEntityDescriptor = Object.freeze({
        id,
        sourcePath,
        lineNumber,
        lineKind,
        rawLine,
        blockId,
        legacyIdentities: Object.freeze(
          (['tpsId', 'subitemId'] as const)
            .map((key) => Object.freeze({
              key,
              value: readInlineFieldValue(rawLine, key).trim(),
            }))
            .filter((identity) => Boolean(identity.value)),
        ),
      });

      sources.push({
        id,
        path: sourcePath,
        sourcePath,
        name: label,
        basename: label,
        frontmatter: inlineProperties,
        entityType: 'block',
        subpath: blockId ? `#^${blockId}` : '',
        blockId,
        lineKind,
        lineNumber,
        referenceState: blockId ? 'ready' : 'provisional',
        locatorKey,
      });
      descriptorIds.add(normalizeLookupValue(id));
      this.descriptorsById.set(normalizeLookupValue(id), descriptor);
    }

    if (descriptorIds.size > 0) {
      this.descriptorIdsByPath.set(normalizePath(sourcePath), descriptorIds);
    }
    return Object.freeze(sources);
  }

  getDescriptor(id: string): LineEntityDescriptor | null {
    return this.descriptorsById.get(normalizeLookupValue(id)) ?? null;
  }

  async materialize(
    file: TFile,
    record: EntityIndexRecord,
    vault: LineEntityVault,
  ): Promise<LineEntityMaterializationResult> {
    const descriptor = this.getDescriptor(record.id);
    if (!descriptor) {
      throw new LineEntityResolutionError(
        'missing-descriptor',
        'The selected line is no longer present in the current entity snapshot.',
      );
    }

    let result: LineEntityMaterializationResult | null = null;
    const updatedContent = await vault.process(file, (currentContent) => {
      const resolution = resolveLineEntityTarget(currentContent, descriptor);
      const currentLine = resolution.lines[resolution.index];
      const currentBlockId = readLineBlockId(currentLine.text);
      if (currentBlockId) {
        const matchingIndexes = collectNativeBlockIdIndexes(resolution.lines)
          .get(normalizeLookupValue(currentBlockId)) || [];
        if (matchingIndexes.length !== 1) {
          throw new LineEntityResolutionError(
            'duplicate-identity',
            'The selected line has a duplicate native block ID.',
          );
        }
        result = Object.freeze({
          content: currentContent,
          blockId: currentBlockId,
          lineNumber: resolution.index + 1,
          changed: false,
        });
        return currentContent;
      }

      const existingIds = new Set(
        collectNativeBlockIdIndexes(resolution.lines).keys(),
      );
      const blockId = String(this.blockIdFactory(existingIds) || '')
        .trim()
        .replace(/^\^/u, '');
      if (!/^[A-Za-z0-9-]+$/u.test(blockId) || existingIds.has(normalizeLookupValue(blockId))) {
        throw new LineEntityResolutionError(
          'invalid-block-id',
          'Could not create a unique native block ID for the selected line.',
        );
      }

      const updatedLine = appendLineBlockId(currentLine.text, blockId);
      const nextContent = [
        currentContent.slice(0, currentLine.start),
        updatedLine,
        currentContent.slice(currentLine.end),
      ].join('');
      result = Object.freeze({
        content: nextContent,
        blockId,
        lineNumber: resolution.index + 1,
        changed: true,
      });
      return nextContent;
    });

    if (!result) {
      throw new LineEntityResolutionError(
        'stale-source',
        'The selected line could not be resolved after the atomic file update.',
      );
    }
    if (updatedContent !== result.content) {
      result = Object.freeze({ ...result, content: updatedContent });
    }
    return result;
  }
}

export function getLineEntityKind(line: string): EntityIndexLineKind | null {
  const source = String(line || '');
  if (parseTaskLine(source)) return 'task';
  if (MARKDOWN_HEADING_RE.test(stripLineBlockId(source))) return 'heading';
  if (MARKDOWN_LINE_PREFIX_RE.test(source)) return 'bullet';
  return null;
}

export function getLineEntityLabel(
  line: string,
  lineKind: EntityIndexLineKind = getLineEntityKind(line) || 'bullet',
): string {
  let source = stripLineBlockId(String(line || ''));
  if (lineKind === 'task') {
    source = parseTaskLine(source)?.body || source;
  } else if (lineKind === 'heading') {
    source = source.match(MARKDOWN_HEADING_RE)?.[2] || source;
    source = source.replace(/[ \t]+#+[ \t]*$/u, '');
  } else {
    source = source.replace(MARKDOWN_LINE_PREFIX_RE, '');
  }

  const ranges = readSemanticInlineFieldRanges(source)
    .sort((left, right) => right.start - left.start);
  for (const range of ranges) {
    source = `${source.slice(0, range.start)} ${source.slice(range.end)}`;
  }
  source = stripTaskInlinePropsMetadata(source);
  source = source.replace(/<!--\s*-->/gu, ' ');
  TAG_RE.lastIndex = 0;
  source = source.replace(TAG_RE, ' ');
  TAG_RE.lastIndex = 0;
  return source.replace(/[ \t]+/gu, ' ').trim();
}

export function createLineEntityBlockId(existingIds: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const uuid = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replace(/-/gu, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const candidate = `tps-${uuid.slice(0, 16)}`;
    if (!existingIds.has(normalizeLookupValue(candidate))) return candidate;
  }
  return '';
}

export function readyLineEntityLocator(path: string, blockId: string): string {
  return `block:${normalizePath(path)}#^${normalizeLookupValue(blockId)}`;
}

export function provisionalLineEntityLocator(
  path: string,
  lineNumber: number,
  rawLine: string,
): string {
  return `provisional:${normalizePath(path)}:${lineNumber}:${fingerprint(rawLine)}`;
}

function readyLineEntityId(path: string, blockId: string): string {
  return `line:${normalizePath(path)}#^${normalizeLookupValue(blockId)}`;
}

function provisionalLineEntityId(path: string, lineNumber: number, rawLine: string): string {
  return `line-provisional:${normalizePath(path)}:${lineNumber}:${fingerprint(rawLine)}`;
}

function resolveLineEntityTarget(
  content: string,
  descriptor: LineEntityDescriptor,
): { lines: readonly ContentLine[]; index: number } {
  const lines = splitContentLines(content);
  if (descriptor.blockId) {
    const blockMatches = collectNativeBlockIdIndexes(lines)
      .get(normalizeLookupValue(descriptor.blockId)) || [];
    if (blockMatches.length > 1) {
      throw new LineEntityResolutionError(
        'duplicate-identity',
        'The selected line has a duplicate native block ID.',
      );
    }
    if (blockMatches.length === 1) return { lines, index: blockMatches[0] };
  }

  const preferredIndex = descriptor.lineNumber - 1;
  const preferred = lines[preferredIndex];
  if (
    preferred
    && preferred.text === descriptor.rawLine
    && getLineEntityKind(preferred.text) === descriptor.lineKind
  ) {
    return { lines, index: preferredIndex };
  }

  const legacyMatches = new Set<number>();
  for (const identity of descriptor.legacyIdentities) {
    const matches: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (getLineEntityKind(lines[index].text) !== descriptor.lineKind) continue;
      const hasIdentity = normalizeLookupValue(
        readInlineFieldValue(lines[index].text, identity.key),
      ) === normalizeLookupValue(identity.value);
      if (hasIdentity) matches.push(index);
    }
    if (matches.length > 1) {
      throw new LineEntityResolutionError(
        'duplicate-identity',
        'A legacy line identity occurs more than once in the target note.',
      );
    }
    if (matches.length === 1) legacyMatches.add(matches[0]);
  }
  if (legacyMatches.size === 1) {
    return { lines, index: [...legacyMatches][0] };
  }
  if (legacyMatches.size > 1) {
    throw new LineEntityResolutionError(
      'duplicate-identity',
      'The selected line identities resolve to different lines.',
    );
  }

  const exactMatches: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (
      lines[index].text === descriptor.rawLine
      && getLineEntityKind(lines[index].text) === descriptor.lineKind
    ) {
      exactMatches.push(index);
    }
  }
  if (exactMatches.length === 1) return { lines, index: exactMatches[0] };
  if (exactMatches.length > 1) {
    throw new LineEntityResolutionError(
      'duplicate-identity',
      'The selected line occurs more than once after its position changed.',
    );
  }
  throw new LineEntityResolutionError(
    'stale-source',
    'The selected line changed before its reference could be created.',
  );
}

interface ContentLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function splitContentLines(content: string): ContentLine[] {
  const source = String(content || '');
  const lines: ContentLine[] = [];
  const newline = /\r\n|\n|\r/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = newline.exec(source)) !== null) {
    lines.push({
      text: source.slice(cursor, match.index),
      start: cursor,
      end: match.index,
    });
    cursor = match.index + match[0].length;
  }
  lines.push({
    text: source.slice(cursor),
    start: cursor,
    end: source.length,
  });
  return lines;
}

function collectNativeBlockIdIndexes(
  lines: readonly ContentLine[],
): Map<string, number[]> {
  const indexesById = new Map<string, number[]>();
  let inFrontmatter = lines[0]?.text.trim() === '---';
  let fence: { character: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index].text;
    const trimmed = rawLine.trim();
    if (inFrontmatter) {
      if (index > 0 && (trimmed === '---' || trimmed === '...')) {
        inFrontmatter = false;
      }
      continue;
    }
    const fenceMatch = rawLine.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) fence = { character: marker[0], length: marker.length };
      else if (isValidFenceClose(rawLine, marker, fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const blockId = normalizeLookupValue(readLineBlockId(rawLine));
    if (!blockId) continue;
    const indexes = indexesById.get(blockId) || [];
    indexes.push(index);
    indexesById.set(blockId, indexes);
  }
  return indexesById;
}

function isValidFenceClose(
  rawLine: string,
  marker: string,
  fence: { character: string; length: number },
): boolean {
  if (marker[0] !== fence.character || marker.length < fence.length) return false;
  const markerStart = rawLine.indexOf(marker);
  return markerStart >= 0
    && /^[ \t]*$/u.test(rawLine.slice(markerStart + marker.length));
}

function findCaseInsensitiveKey(record: Record<string, unknown>, key: string): string {
  const identity = normalizeLookupValue(key);
  return Object.keys(record).find((candidate) => normalizeLookupValue(candidate) === identity) || '';
}

function normalizeSourcePath(path: string): string {
  return String(path || '').replace(/\\/gu, '/').replace(/\/{2,}/gu, '/').trim();
}

function normalizePath(path: string): string {
  return normalizeLookupValue(normalizeSourcePath(path));
}

function normalizeLookupValue(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
