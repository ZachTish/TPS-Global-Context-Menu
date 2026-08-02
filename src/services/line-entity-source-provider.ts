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
  readLineSemanticMetadata,
  readLineBlockId,
  stripLineBlockId,
  type TaskInlineField,
} from '../utils/task-line-metadata';
import { parseStringListInput } from '../utils/list-utils';
import {
  scanMarkdownDocumentLines,
  type MarkdownDocumentLine,
} from '../utils/markdown-document-lines';

const MARKDOWN_LINE_PREFIX_RE = /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+/u;
const MARKDOWN_HEADING_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(.+)$/u;

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

export interface ParsedLineEntityMetadata {
  readonly kind: EntityIndexLineKind;
  readonly fields: TaskInlineField[];
  readonly tags: string[];
  readonly displayTitle: string;
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
 * reference pickers. When Kind is registered, every supported Markdown line
 * receives its structural identity even when it has no inline fields.
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
    const kindDimension = (definitions || []).find(
      (definition) => normalizeLookupValue(definition.name) === 'kind',
    );
    const kindPropertyKeys = new Set(
      (kindDimension?.propertyKeys || []).map(normalizeLookupValue).filter(Boolean),
    );
    if (configuredKeys.size === 0 && !kindDimension) return Object.freeze([]);

    const sources: EntityIndexSource[] = [];
    const descriptorIds = new Set<string>();
    const lines = scanMarkdownDocumentLines(content);
    const nativeBlockIdIndexes = collectNativeBlockIdIndexes(lines);

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index].text;
      if (!lines[index].isContent) continue;

      const lineKind = getLineEntityKind(rawLine);
      if (!lineKind) continue;
      const semantic = parseLineEntityMetadata(rawLine, lineKind);
      if (!semantic) continue;
      const fields = semantic.fields
        .filter((field) => configuredKeys.has(normalizeLookupValue(field.key)));
      // Structural identity is additive: every supported line can satisfy its
      // native kind while an explicit inline Kind (for example `project`)
      // remains a second identity. Notes with `kind: task` continue to enter
      // through the note provider, so neither record shape is excluded.
      const structuralDimensions = kindDimension
        ? { [kindDimension.name]: [lineKind] }
        : null;
      if (fields.length === 0 && !structuralDimensions) continue;

      const inlineProperties = Object.create(null) as Record<string, unknown>;
      for (const field of fields) {
        const fieldValues: unknown[] = kindPropertyKeys.has(normalizeLookupValue(field.key))
          ? parseStringListInput(field.value)
          : [field.value];
        if (fieldValues.length === 0) continue;
        const existing = findCaseInsensitiveKey(inlineProperties, field.key);
        if (!existing) {
          inlineProperties[field.key] = fieldValues.length === 1 ? fieldValues[0] : fieldValues;
          continue;
        }
        const values = Array.isArray(inlineProperties[existing])
          ? [...inlineProperties[existing] as unknown[]]
          : [inlineProperties[existing]];
        values.push(...fieldValues);
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
      const label = semantic.displayTitle || `Line ${lineNumber}`;
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
              value: semantic.fields.find((field) => normalizeLookupValue(field.key) === normalizeLookupValue(key))?.value.trim() || '',
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
        ...(structuralDimensions ? { dimensions: structuralDimensions } : {}),
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
  return parseLineEntityMetadata(line, lineKind)?.displayTitle || '';
}

export function parseLineEntityMetadata(
  line: string,
  lineKind: EntityIndexLineKind | null = getLineEntityKind(line),
): ParsedLineEntityMetadata | null {
  if (!lineKind) return null;
  let source = stripLineBlockId(String(line || ''));
  if (lineKind === 'task') {
    source = parseTaskLine(source)?.body || source;
  } else if (lineKind === 'heading') {
    source = source.match(MARKDOWN_HEADING_RE)?.[2] || source;
    source = source.replace(/[ \t]+#+[ \t]*$/u, '');
  } else {
    source = source.replace(MARKDOWN_LINE_PREFIX_RE, '');
  }
  const semantic = readLineSemanticMetadata(source);
  return Object.freeze({
    kind: lineKind,
    fields: semantic.fields,
    tags: semantic.tags,
    displayTitle: semantic.displayText,
  });
}

export function readLineEntityInlineFieldValue(line: string, key: string): string | null {
  const wanted = String(key || '').trim().toLocaleLowerCase();
  if (!wanted) return null;
  const field = parseLineEntityMetadata(line)?.fields
    .find((candidate) => candidate.key.trim().toLocaleLowerCase() === wanted);
  return field ? field.value : null;
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
): { lines: readonly MarkdownDocumentLine[]; index: number } {
  const lines = scanMarkdownDocumentLines(content);
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
    && preferred.isContent
    && preferred.text === descriptor.rawLine
    && getLineEntityKind(preferred.text) === descriptor.lineKind
  ) {
    return { lines, index: preferredIndex };
  }

  const legacyMatches = new Set<number>();
  for (const identity of descriptor.legacyIdentities) {
    const matches: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].isContent) continue;
      if (getLineEntityKind(lines[index].text) !== descriptor.lineKind) continue;
      const hasIdentity = normalizeLookupValue(
        readLineEntityInlineFieldValue(lines[index].text, identity.key),
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
      lines[index].isContent
      && lines[index].text === descriptor.rawLine
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

function collectNativeBlockIdIndexes(
  lines: readonly MarkdownDocumentLine[],
): Map<string, number[]> {
  const indexesById = new Map<string, number[]>();
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index].text;
    if (!lines[index].isContent) continue;
    const blockId = normalizeLookupValue(readLineBlockId(rawLine));
    if (!blockId) continue;
    const indexes = indexesById.get(blockId) || [];
    indexes.push(index);
    indexesById.set(blockId, indexes);
  }
  return indexesById;
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
