import { MarkdownView, Notice, TFile, parseYaml, stringifyYaml } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import { casefold, deleteValueCaseInsensitive, findKeyCaseInsensitive, setValueCaseInsensitive } from '../core';
import { getCompatibleMarkdownViewFromLeaf, getViewMode, pickBestMarkdownLeaf } from './leaf-resolver';
import { normalizeTagList } from '../utils/tag-utils';
import { normalizeCompletedDateValue } from '../utils/completed-date-utils';
import type { FilePropertiesMutationCause } from './file-properties-service';

type FrontmatterRecord = Record<string, unknown>;
type FrontmatterMutator = (frontmatter: FrontmatterRecord) => void | Promise<void>;
type SynchronousFrontmatterMutator = (frontmatter: FrontmatterRecord) => void;
type SourcePreservingMutationOptions = {
  emitEvents?: boolean;
  updateEntityIndex?: boolean;
};
type OwnedValueSnapshot = {
  actualKey: string | null;
  signature: string;
};
type OwnedSourceMutation = {
  sourceKey: string;
  remove: boolean;
  value?: unknown;
};
type SourceLine = {
  start: number;
  end: number;
  text: string;
};
type SourceKeySpan = {
  key: string;
  keyToken: string;
  start: number;
  end: number;
};
type ActivityChange = {
  key: string;
  from?: unknown;
  to?: unknown;
  added?: unknown[];
  removed?: unknown[];
};

export class FrontmatterMutationService {
  private writeChains = new Map<string, Promise<void>>();
  private warnedPaths = new Set<string>();
  private static readonly PARSE_RETRY_DELAYS_MS = [40, 120, 250];

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  async process(
    file: TFile,
    mutator: FrontmatterMutator,
    cause: FilePropertiesMutationCause = { kind: 'user' },
  ): Promise<boolean> {
    if (!(file instanceof TFile)) return false;
    if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;
    if (file.extension.toLowerCase() !== 'md') {
      return this.plugin.filePropertiesService?.isPropertyTarget(file)
        ? this.plugin.filePropertiesService.process(file, mutator, cause)
        : false;
    }

    let changed = false;
    let nextTitle: string | null = null;
    let indexedFrontmatter: FrontmatterRecord | null = null;
    const started = performance.now();
    await this.runSerialized(file, async () => {
      const attempt = await this.readParsedWithRetries(file);
      if (!attempt) return;

      const { normalized, parsed } = attempt;
      if (!parsed.ok) {
        const { reason, error } = parsed as { ok: false; reason: string; error?: unknown };
        this.warnMalformed(file, reason, error);
        return;
      }

      const frontmatter = parsed.frontmatter;
      const originalFrontmatter = { ...frontmatter };
      const originalTitle = readFrontmatterString(originalFrontmatter, 'title').trim();
      const before = stringifyYaml(this.sortFrontmatter(frontmatter)).trimEnd();
      await mutator(frontmatter);
      this.normalizeTagValues(frontmatter);
      this.normalizeDateTimeValues(frontmatter);
      this.removeEmptyValuesChangedByMutation(frontmatter, originalFrontmatter);
      this.appendActivityEntryIfNeeded(frontmatter, originalFrontmatter);
      const mutatedTitle = readFrontmatterString(frontmatter, 'title').trim();
      if (mutatedTitle && mutatedTitle !== originalTitle) {
        nextTitle = mutatedTitle;
      }
      const sorted = this.sortFrontmatter(frontmatter);
      const after = stringifyYaml(sorted).trimEnd();

      const nextContent = after
        ? `${normalized.bom}---\n${after}\n---${parsed.body ? `\n${parsed.body}` : '\n'}`
        : `${normalized.bom}${parsed.body}`;

      if (nextContent !== normalized.fullContent || before !== after) {
        const validation = this.validateNextContent(nextContent);
        if (validation.ok !== true) {
          this.warnMalformed(file, validation.reason, validation.error);
          logger.warn('[TPS GCM] Refusing frontmatter write that failed post-write validation', {
            file: file.path,
            reason: validation.reason,
            stack: new Error().stack,
          });
          return;
        }
        if (!this.hasSuspiciousBrokenSubitemLine(normalized.fullContent) && this.hasSuspiciousBrokenSubitemLine(nextContent)) {
          this.warnMalformed(file, 'suspicious-broken-subitem-line');
          logger.warn('[TPS GCM] Refusing frontmatter write that would introduce a broken subitem line', {
            file: file.path,
            stack: new Error().stack,
          });
          return;
        }
        await this.writeContent(file, nextContent);
        const sourcePluginId = String(cause.sourcePluginId || this.plugin.manifest.id);
        this.plugin.eventService.emitFilesUpdated([file.path], { sourcePluginId });
        if (cause.kind !== 'automation') {
          this.plugin.eventService.emitExplicitAction([file.path], {
            sourcePluginId,
            source: String(cause.surface || 'frontmatter'),
          });
        }
        indexedFrontmatter = { ...sorted };
        changed = true;
      }
    });

    logger.perf('frontmatterMutation.process', {
      file: file.path,
      changed,
      durationMs: Math.round(performance.now() - started),
      stack: changed ? compactStack(new Error().stack) : undefined,
    });
    if (changed && indexedFrontmatter) {
      this.plugin.entityIndexService?.upsertFile(file, indexedFrontmatter);
    }
    if (changed && nextTitle && this.plugin.settings.enableAutoRename) {
      const liveFile = this.plugin.app.vault.getFileByPath(file.path);
      if (liveFile instanceof TFile) {
        await this.plugin.fileNamingService.updateFilenameIfNeeded(liveFile, {
          bypassCreationGrace: true,
          titleOverride: nextTitle,
        });
      }
    }
    return changed;
  }

  /**
   * Atomically updates only the named top-level frontmatter keys while leaving
   * every unrelated source byte alone. This is intentionally narrower than
   * process(): automation-owned presentation fields must not reserialize a
   * native record's identity, timestamps, tags, key order, comments, or body.
   */
  async canProcessOwnedKeysPreservingSource(
    file: TFile,
    ownedKeys: string[],
    mutator?: SynchronousFrontmatterMutator,
  ): Promise<boolean> {
    if (!(file instanceof TFile)) return false;
    if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;
    if (file.extension.toLowerCase() !== 'md') return false;
    const keys = this.normalizeOwnedKeys(ownedKeys);
    if (keys.length === 0) return false;

    try {
      const vault = this.plugin.app.vault as typeof this.plugin.app.vault & {
        read?: (target: TFile) => Promise<string>;
      };
      const raw = String(await (
        typeof vault.read === 'function' ? vault.read(file) : vault.cachedRead(file)
      ) || '');
      if (/\r(?!\n)/u.test(raw)) return false;
      const parsed = this.parseFrontmatterDocument(
        raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'),
      );
      if (parsed.ok !== true) return false;
      if (
        this.findDuplicateOwnedSourceKey(raw, keys)
        || !this.canRewriteOwnedFrontmatterSource(raw, parsed.frontmatter, keys)
      ) return false;
      if (!mutator) return true;
      return this.canApplyOwnedMutatorDryRun(raw, parsed.frontmatter, keys, mutator);
    } catch {
      return false;
    }
  }

  async processOwnedKeysPreservingSource(
    file: TFile,
    ownedKeys: string[],
    mutator: SynchronousFrontmatterMutator,
    cause: FilePropertiesMutationCause = { kind: 'automation' },
    options: SourcePreservingMutationOptions = {},
  ): Promise<boolean> {
    if (!(file instanceof TFile)) return false;
    if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;
    if (file.extension.toLowerCase() !== 'md') {
      return this.plugin.filePropertiesService?.isPropertyTarget(file)
        ? this.plugin.filePropertiesService.process(file, mutator, cause)
        : false;
    }

    const keys = this.normalizeOwnedKeys(ownedKeys);
    if (keys.length === 0) return false;

    let changed = false;
    let indexedFrontmatter: FrontmatterRecord | null = null;
    const started = performance.now();
    await this.runSerialized(file, async () => {
      await this.plugin.app.vault.process(file, (currentContent) => {
        const raw = String(currentContent || '');
        if (/\r(?!\n)/u.test(raw)) {
          this.warnMalformed(file, 'unsupported-bare-cr-line-ending');
          return raw;
        }
        const contentForParsing = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
        const parsed = this.parseFrontmatterDocument(contentForParsing);
        if (parsed.ok !== true) {
          this.warnMalformed(file, parsed.reason, parsed.error);
          return raw;
        }
        const duplicateOwnedKey = this.findDuplicateOwnedSourceKey(raw, keys);
        if (duplicateOwnedKey) {
          this.warnMalformed(file, `duplicate-owned-key:${duplicateOwnedKey}`);
          logger.warn('[TPS GCM] Refusing ambiguous source-preserving frontmatter write', {
            file: file.path,
            duplicateOwnedKey,
            ownedKeys: keys,
          });
          return raw;
        }
        if (!this.canRewriteOwnedFrontmatterSource(raw, parsed.frontmatter, keys)) {
          this.warnMalformed(file, 'unsupported-owned-key-source-layout');
          logger.warn('[TPS GCM] Refusing source-preserving write whose parsed owned keys do not map to rewritable source', {
            file: file.path,
            ownedKeys: keys,
          });
          return raw;
        }

        const frontmatter = parsed.frontmatter;
        const before = this.snapshotOwnedValues(frontmatter, keys);
        mutator(frontmatter);
        const mutations = this.collectOwnedMutations(before, frontmatter, keys);
        if (mutations.length === 0) return raw;

        const nextContent = this.rewriteOwnedFrontmatterSource(raw, mutations);
        if (nextContent === raw) return raw;

        const validation = this.validateNextContent(nextContent);
        if (validation.ok !== true) {
          this.warnMalformed(file, validation.reason, validation.error);
          logger.warn('[TPS GCM] Refusing source-preserving frontmatter write that failed validation', {
            file: file.path,
            reason: validation.reason,
            ownedKeys: keys,
            stack: new Error().stack,
          });
          return raw;
        }
        if (!this.hasSuspiciousBrokenSubitemLine(raw) && this.hasSuspiciousBrokenSubitemLine(nextContent)) {
          this.warnMalformed(file, 'suspicious-broken-subitem-line');
          logger.warn('[TPS GCM] Refusing source-preserving frontmatter write that would introduce a broken subitem line', {
            file: file.path,
            ownedKeys: keys,
            stack: new Error().stack,
          });
          return raw;
        }

        const indexedDocument = this.parseFrontmatterDocument(
          nextContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'),
        );
        if (indexedDocument.ok !== true) {
          this.warnMalformed(file, indexedDocument.reason, indexedDocument.error);
          logger.warn('[TPS GCM] Refusing source-preserving frontmatter write that could not be re-indexed', {
            file: file.path,
            reason: indexedDocument.reason,
            ownedKeys: keys,
            stack: new Error().stack,
          });
          return raw;
        }

        indexedFrontmatter = { ...indexedDocument.frontmatter };
        changed = true;
        return nextContent;
      });

      if (!changed || options.emitEvents === false) return;
      const sourcePluginId = String(cause.sourcePluginId || this.plugin.manifest.id);
      this.plugin.eventService.emitFilesUpdated([file.path], { sourcePluginId });
      if (cause.kind !== 'automation') {
        this.plugin.eventService.emitExplicitAction([file.path], {
          sourcePluginId,
          source: String(cause.surface || 'frontmatter'),
        });
      }
    });

    logger.perf('frontmatterMutation.processOwnedKeysPreservingSource', {
      file: file.path,
      changed,
      ownedKeys: keys,
      durationMs: Math.round(performance.now() - started),
      stack: changed ? compactStack(new Error().stack) : undefined,
    });
    if (changed && indexedFrontmatter && options.updateEntityIndex !== false) {
      this.plugin.entityIndexService?.upsertFile(file, indexedFrontmatter);
    }
    return changed;
  }

  async updateValues(
    files: TFile[],
    updates: Record<string, unknown>,
    cause: FilePropertiesMutationCause = { kind: 'user' },
  ): Promise<TFile[]> {
    const { markdownFiles, nonMarkdownFiles } = this.partitionByStorageType(files);
    await this.warnIfSchedulingMultiDateTaskContainer(markdownFiles, updates);
    const updatedNonMarkdown = await this.plugin.filePropertiesService?.updateValues(nonMarkdownFiles, updates, cause) ?? [];
    const updatedMarkdown = await this.applyToFiles(markdownFiles, async (frontmatter) => {
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === null) {
          deleteValueCaseInsensitive(frontmatter, key);
          continue;
        }
        setValueCaseInsensitive(frontmatter, key, value);
      }
    }, cause);
    return [...updatedMarkdown, ...updatedNonMarkdown];
  }

  async setListValues(files: TFile[], key: string, values: unknown[], cause: FilePropertiesMutationCause = { kind: 'user' }): Promise<TFile[]> {
    const { markdownFiles, nonMarkdownFiles } = this.partitionByStorageType(files);
    const updatedNonMarkdown = await this.plugin.filePropertiesService?.setListValues(nonMarkdownFiles, key, values, cause) ?? [];
    const updatedMarkdown = await this.applyToFiles(markdownFiles, async (frontmatter) => {
      const normalized = this.normalizeList(values);
      if (normalized.length === 0) {
        deleteValueCaseInsensitive(frontmatter, key);
      } else {
        setValueCaseInsensitive(frontmatter, key, normalized);
      }
    }, cause);
    return [...updatedMarkdown, ...updatedNonMarkdown];
  }

  async addValuesToList(files: TFile[], key: string, values: unknown[], cause: FilePropertiesMutationCause = { kind: 'user' }): Promise<TFile[]> {
    const additions = this.normalizeList(values);
    if (additions.length === 0) return [];
    const { markdownFiles, nonMarkdownFiles } = this.partitionByStorageType(files);
    const updatedNonMarkdown = await this.plugin.filePropertiesService?.addValuesToList(nonMarkdownFiles, key, additions, cause) ?? [];
    const updatedMarkdown = await this.applyToFiles(markdownFiles, async (frontmatter) => {
      const existingKey = findKeyCaseInsensitive(frontmatter, key) || key;
      const current = this.normalizeList(frontmatter[existingKey]);
      const merged = [...current];
      const seen = new Set(current.map((value) => casefold(String(value))));
      for (const value of additions) {
        const marker = casefold(String(value));
        if (seen.has(marker)) continue;
        seen.add(marker);
        merged.push(value);
      }
      setValueCaseInsensitive(frontmatter, existingKey, merged);
    }, cause);
    return [...updatedMarkdown, ...updatedNonMarkdown];
  }

  async removeValuesFromList(files: TFile[], key: string, values: unknown[], cause: FilePropertiesMutationCause = { kind: 'user' }): Promise<TFile[]> {
    const removals = new Set(this.normalizeList(values).map((value) => casefold(String(value))));
    if (removals.size === 0) return [];
    const { markdownFiles, nonMarkdownFiles } = this.partitionByStorageType(files);
    const updatedNonMarkdown = await this.plugin.filePropertiesService?.removeValuesFromList(nonMarkdownFiles, key, values, cause) ?? [];
    const updatedMarkdown = await this.applyToFiles(markdownFiles, async (frontmatter) => {
      const existingKey = findKeyCaseInsensitive(frontmatter, key);
      if (!existingKey) return;
      const current = this.normalizeList(frontmatter[existingKey]);
      const filtered = current.filter((value) => !removals.has(casefold(String(value))));
      if (filtered.length === 0) {
        delete frontmatter[existingKey];
      } else {
        setValueCaseInsensitive(frontmatter, existingKey, filtered);
      }
    }, cause);
    return [...updatedMarkdown, ...updatedNonMarkdown];
  }

  async setDateValue(files: TFile[], key: string, value: string | null, cause: FilePropertiesMutationCause = { kind: 'user' }): Promise<TFile[]> {
    const { markdownFiles, nonMarkdownFiles } = this.partitionByStorageType(files);
    const normalized = normalizeObsidianDateTimeValue(value);
    await this.warnIfSchedulingMultiDateTaskContainer(markdownFiles, { [key]: normalized || null });
    const updatedNonMarkdown = await this.plugin.filePropertiesService?.updateValues(nonMarkdownFiles, {
      [key]: normalized || null,
    }, cause) ?? [];
    const updatedMarkdown = await this.applyToFiles(markdownFiles, async (frontmatter) => {
      if (!normalized) {
        deleteValueCaseInsensitive(frontmatter, key);
      } else {
        setValueCaseInsensitive(frontmatter, key, normalized);
      }
    }, cause);
    return [...updatedMarkdown, ...updatedNonMarkdown];
  }

  async deleteKeys(files: TFile[], keys: string[], cause: FilePropertiesMutationCause = { kind: 'user' }): Promise<TFile[]> {
    const normalizedKeys = keys.map((key) => String(key || '').trim()).filter(Boolean);
    if (normalizedKeys.length === 0) return [];
    const { markdownFiles, nonMarkdownFiles } = this.partitionByStorageType(files);
    const updatedNonMarkdown = await this.plugin.filePropertiesService?.deleteKeys(nonMarkdownFiles, normalizedKeys, cause) ?? [];
    const updatedMarkdown = await this.applyToFiles(markdownFiles, async (frontmatter) => {
      for (const key of normalizedKeys) {
        deleteValueCaseInsensitive(frontmatter, key);
      }
    }, cause);
    return [...updatedMarkdown, ...updatedNonMarkdown];
  }

  private normalizeOwnedKeys(keys: string[]): string[] {
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const rawKey of keys || []) {
      const key = String(rawKey || '').trim();
      const folded = casefold(key);
      if (!key || seen.has(folded)) continue;
      seen.add(folded);
      normalized.push(key);
    }
    return normalized;
  }

  private snapshotOwnedValues(frontmatter: FrontmatterRecord, keys: string[]): Map<string, OwnedValueSnapshot> {
    const snapshots = new Map<string, OwnedValueSnapshot>();
    for (const requestedKey of keys) {
      const actualKey = findKeyCaseInsensitive(frontmatter, requestedKey);
      snapshots.set(casefold(requestedKey), {
        actualKey,
        signature: actualKey ? this.ownedValueSignature(frontmatter[actualKey]) : 'missing',
      });
    }
    return snapshots;
  }

  private collectOwnedMutations(
    before: Map<string, OwnedValueSnapshot>,
    frontmatter: FrontmatterRecord,
    keys: string[],
  ): OwnedSourceMutation[] {
    const mutations: OwnedSourceMutation[] = [];
    for (const requestedKey of keys) {
      const snapshot = before.get(casefold(requestedKey));
      const afterKey = findKeyCaseInsensitive(frontmatter, requestedKey);
      const beforeExists = !!snapshot?.actualKey;
      const afterExists = !!afterKey;
      if (!beforeExists && !afterExists) continue;

      const afterSignature = afterKey ? this.ownedValueSignature(frontmatter[afterKey]) : 'missing';
      if (beforeExists === afterExists && snapshot?.signature === afterSignature) continue;

      mutations.push({
        sourceKey: snapshot?.actualKey || afterKey || requestedKey,
        remove: !afterKey,
        value: afterKey ? frontmatter[afterKey] : undefined,
      });
    }
    return mutations;
  }

  private ownedValueSignature(value: unknown): string {
    if (value instanceof Date) return `date:${value.toISOString()}`;
    if (value === undefined) return 'undefined';
    if (typeof value === 'number' && Number.isNaN(value)) return 'number:NaN';
    try {
      return `${typeof value}:${JSON.stringify(value, (_key, entry) => {
        if (entry instanceof Date) return { __tpsDate: entry.toISOString() };
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          return Object.fromEntries(
            Object.entries(entry as Record<string, unknown>)
              .sort(([left], [right]) => left.localeCompare(right)),
          );
        }
        return entry;
      })}`;
    } catch {
      return `${typeof value}:${String(value)}`;
    }
  }

  private findDuplicateOwnedSourceKey(rawContent: string, ownedKeys: string[]): string | null {
    const source = rawContent.startsWith('\uFEFF') ? rawContent.slice(1) : rawContent;
    const openStart = this.findSourceFrontmatterStart(source);
    if (openStart < 0) return null;
    const openingLineEnd = source.indexOf('\n', openStart);
    if (openingLineEnd < 0) return null;
    const blockStart = openingLineEnd + 1;
    const closeStart = this.findSourceFrontmatterClose(source, blockStart);
    if (closeStart < 0) return null;

    const owned = new Map(ownedKeys.map((key) => [casefold(key), key]));
    const counts = new Map<string, number>();
    for (const span of this.findSourceKeySpans(source, blockStart, closeStart)) {
      const folded = casefold(span.key);
      if (!owned.has(folded)) continue;
      const count = (counts.get(folded) || 0) + 1;
      if (count > 1) return owned.get(folded) || span.key;
      counts.set(folded, count);
    }
    return null;
  }

  private canRewriteOwnedFrontmatterSource(
    rawContent: string,
    frontmatter: FrontmatterRecord,
    ownedKeys: string[],
  ): boolean {
    const source = rawContent.startsWith('\uFEFF') ? rawContent.slice(1) : rawContent;
    const openStart = this.findSourceFrontmatterStart(source);
    const spans: SourceKeySpan[] = [];
    if (openStart >= 0) {
      const openingLineEnd = source.indexOf('\n', openStart);
      if (openingLineEnd < 0) return false;
      const blockStart = openingLineEnd + 1;
      const closeStart = this.findSourceFrontmatterClose(source, blockStart);
      if (closeStart < 0) return false;
      spans.push(...this.findSourceKeySpans(source, blockStart, closeStart));
    }

    const spansByKey = new Map<string, SourceKeySpan[]>();
    for (const span of spans) {
      const folded = casefold(span.key);
      const matches = spansByKey.get(folded) || [];
      matches.push(span);
      spansByKey.set(folded, matches);
    }

    const dryRunMutations: OwnedSourceMutation[] = [];
    const dryRunValues = new Map<string, string>();
    for (const requestedKey of ownedKeys) {
      const actualKey = findKeyCaseInsensitive(frontmatter, requestedKey);
      if (!actualKey) continue;
      const matchingSpans = spansByKey.get(casefold(actualKey)) || [];
      if (matchingSpans.length !== 1) return false;
      const marker = `__tps_owned_write_value_${dryRunValues.size + 1}__`;
      dryRunValues.set(actualKey, marker);
      dryRunMutations.push({ sourceKey: actualKey, remove: false, value: marker });
    }

    const occupiedKeys = new Set([
      ...Object.keys(frontmatter).map(casefold),
      ...spans.map((span) => casefold(span.key)),
    ]);
    let probeKey = '__tps_owned_write_preflight__';
    for (let suffix = 2; occupiedKeys.has(casefold(probeKey)); suffix += 1) {
      probeKey = `__tps_owned_write_preflight_${suffix}__`;
    }
    const probeValue = '__tps_owned_write_probe__';
    dryRunMutations.push({ sourceKey: probeKey, remove: false, value: probeValue });

    const rewritten = this.rewriteOwnedFrontmatterSource(rawContent, dryRunMutations);
    if (rewritten === rawContent) return false;
    const parsedDryRun = this.parseFrontmatterDocument(
      rewritten.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'),
    );
    if (parsedDryRun.ok !== true) return false;
    for (const [key, marker] of dryRunValues) {
      const persistedKey = findKeyCaseInsensitive(parsedDryRun.frontmatter, key);
      if (!persistedKey || parsedDryRun.frontmatter[persistedKey] !== marker) return false;
    }
    const persistedProbeKey = findKeyCaseInsensitive(parsedDryRun.frontmatter, probeKey);
    return Boolean(
      persistedProbeKey
      && parsedDryRun.frontmatter[persistedProbeKey] === probeValue
    );
  }

  private canApplyOwnedMutatorDryRun(
    rawContent: string,
    parsedFrontmatter: FrontmatterRecord,
    ownedKeys: string[],
    mutator: SynchronousFrontmatterMutator,
  ): boolean {
    const candidate = { ...parsedFrontmatter };
    const before = this.snapshotOwnedValues(candidate, ownedKeys);
    try {
      mutator(candidate);
    } catch {
      return false;
    }
    const mutations = this.collectOwnedMutations(before, candidate, ownedKeys);
    if (mutations.length === 0) return true;
    const rewritten = this.rewriteOwnedFrontmatterSource(rawContent, mutations);
    if (rewritten === rawContent) return false;
    const validation = this.validateNextContent(rewritten);
    if (validation.ok !== true) return false;
    const parsed = this.parseFrontmatterDocument(
      rewritten.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'),
    );
    if (parsed.ok !== true) return false;
    for (const key of ownedKeys) {
      const expectedKey = findKeyCaseInsensitive(candidate, key);
      const actualKey = findKeyCaseInsensitive(parsed.frontmatter, key);
      if (!expectedKey && !actualKey) continue;
      if (!expectedKey || !actualKey) return false;
      if (
        this.ownedValueSignature(candidate[expectedKey])
        !== this.ownedValueSignature(parsed.frontmatter[actualKey])
      ) return false;
    }
    return true;
  }

  private rewriteOwnedFrontmatterSource(rawContent: string, mutations: OwnedSourceMutation[]): string {
    if (mutations.length === 0) return rawContent;
    const bom = rawContent.startsWith('\uFEFF') ? '\uFEFF' : '';
    const source = bom ? rawContent.slice(1) : rawContent;
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const openStart = this.findSourceFrontmatterStart(source);

    if (openStart < 0) {
      const additions = mutations
        .filter((mutation) => !mutation.remove)
        .map((mutation) => this.serializeOwnedProperty(mutation.sourceKey, mutation.value, newline));
      if (additions.length === 0) return rawContent;
      return `${bom}---${newline}${additions.join(newline)}${newline}---${newline}${source}`;
    }

    const openingLineEnd = source.indexOf('\n', openStart);
    if (openingLineEnd < 0) return rawContent;
    const blockStart = openingLineEnd + 1;
    const closeStart = this.findSourceFrontmatterClose(source, blockStart);
    if (closeStart < 0) return rawContent;

    const spansByKey = new Map<string, SourceKeySpan[]>();
    for (const span of this.findSourceKeySpans(source, blockStart, closeStart)) {
      const folded = casefold(span.key);
      const spans = spansByKey.get(folded) || [];
      spans.push(span);
      spansByKey.set(folded, spans);
    }

    const patches: Array<{ start: number; end: number; text: string }> = [];
    const additions: string[] = [];
    for (const mutation of mutations) {
      const spans = spansByKey.get(casefold(mutation.sourceKey)) || [];
      if (spans.length === 0) {
        if (!mutation.remove) {
          additions.push(this.serializeOwnedProperty(mutation.sourceKey, mutation.value, newline));
        }
        continue;
      }
      if (spans.length !== 1) return rawContent;
      const target = spans[0];
      if (mutation.remove) {
        patches.push({ start: target.start, end: target.end, text: '' });
      } else {
        const original = source.slice(target.start, target.end);
        const trailingNewline = original.endsWith('\r\n')
          ? '\r\n'
          : original.endsWith('\n')
            ? '\n'
            : '';
        patches.push({
          start: target.start,
          end: target.end,
          text: `${this.serializeOwnedProperty(target.key, mutation.value, newline, target.keyToken)}${trailingNewline}`,
        });
      }
    }

    if (additions.length > 0) {
      const needsLeadingNewline = closeStart > blockStart && source[closeStart - 1] !== '\n';
      patches.push({
        start: closeStart,
        end: closeStart,
        text: `${needsLeadingNewline ? newline : ''}${additions.join(newline)}${newline}`,
      });
    }

    let rewritten = source;
    for (const patch of patches.sort((left, right) => right.start - left.start || right.end - left.end)) {
      rewritten = `${rewritten.slice(0, patch.start)}${patch.text}${rewritten.slice(patch.end)}`;
    }
    return `${bom}${rewritten}`;
  }

  private findSourceFrontmatterStart(source: string): number {
    if (source.startsWith('---\n') || source.startsWith('---\r\n')) return 0;
    const leadingWhitespace = source.match(/^[ \t\r\n]*/)?.[0] || '';
    const start = leadingWhitespace.length;
    if (start > 0 && (source.startsWith('---\n', start) || source.startsWith('---\r\n', start))) {
      return start;
    }
    return -1;
  }

  private findSourceFrontmatterClose(source: string, blockStart: number): number {
    let cursor = blockStart;
    while (cursor <= source.length) {
      const newlineIndex = source.indexOf('\n', cursor);
      const lineEnd = newlineIndex < 0 ? source.length : newlineIndex;
      const contentEnd = lineEnd > cursor && source[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;
      const text = source.slice(cursor, contentEnd);
      if (/^(?:---|\.\.\.)[ \t]*$/.test(text)) return cursor;
      if (newlineIndex < 0) break;
      cursor = newlineIndex + 1;
    }
    return -1;
  }

  private findSourceKeySpans(source: string, blockStart: number, blockEnd: number): SourceKeySpan[] {
    const lines = this.readSourceLines(source, blockStart, blockEnd);
    const keyLines = lines
      .map((line, index) => ({ line, index, parsed: this.parseSourceKeyLine(line.text) }))
      .filter((entry): entry is { line: SourceLine; index: number; parsed: { key: string; keyToken: string; tail: string } } => !!entry.parsed);
    const spans: SourceKeySpan[] = [];

    for (const entry of keyLines) {
      let end = entry.line.end;
      const tail = entry.parsed.tail.trim();
      const hasBlockValue = !tail || /^[|>][+\-]?\d?(?:\s+#.*)?$/.test(tail);
      if (hasBlockValue) {
        for (let index = entry.index + 1; index < lines.length; index++) {
          const continuation = lines[index];
          if (!continuation.text) {
            const next = lines[index + 1];
            if (!next || !/^[ \t]/.test(next.text)) break;
            end = continuation.end;
            continue;
          }
          if (!/^[ \t]/.test(continuation.text)) break;
          end = continuation.end;
        }
      }
      spans.push({ key: entry.parsed.key, keyToken: entry.parsed.keyToken, start: entry.line.start, end });
    }
    return spans;
  }

  private readSourceLines(source: string, start: number, end: number): SourceLine[] {
    const lines: SourceLine[] = [];
    let cursor = start;
    while (cursor < end) {
      const newlineIndex = source.indexOf('\n', cursor);
      const lineEnd = newlineIndex < 0 || newlineIndex >= end ? end : newlineIndex + 1;
      let contentEnd = lineEnd;
      if (contentEnd > cursor && source[contentEnd - 1] === '\n') contentEnd -= 1;
      if (contentEnd > cursor && source[contentEnd - 1] === '\r') contentEnd -= 1;
      lines.push({ start: cursor, end: lineEnd, text: source.slice(cursor, contentEnd) });
      cursor = lineEnd;
    }
    return lines;
  }

  private parseSourceKeyLine(line: string): { key: string; keyToken: string; tail: string } | null {
    if (!line || /^[ \t#]/.test(line)) return null;
    if (line[0] === '"') {
      let escaped = false;
      for (let index = 1; index < line.length; index++) {
        const character = line[index];
        if (character === '"' && !escaped) {
          const suffix = line.slice(index + 1);
          const separator = suffix.match(/^[ \t]*:[ \t]*/);
          if (!separator) return null;
          let key: string;
          try {
            key = JSON.parse(line.slice(0, index + 1));
          } catch {
            return null;
          }
          return {
            key: String(key),
            keyToken: line.slice(0, index + 1),
            tail: suffix.slice(separator[0].length),
          };
        }
        escaped = character === '\\' && !escaped;
        if (character !== '\\') escaped = false;
      }
      return null;
    }
    if (line[0] === "'") {
      let index = 1;
      while (index < line.length) {
        if (line[index] !== "'") {
          index += 1;
          continue;
        }
        if (line[index + 1] === "'") {
          index += 2;
          continue;
        }
        const suffix = line.slice(index + 1);
        const separator = suffix.match(/^[ \t]*:[ \t]*/);
        if (!separator) return null;
        return {
          key: line.slice(1, index).replace(/''/g, "'"),
          keyToken: line.slice(0, index + 1),
          tail: suffix.slice(separator[0].length),
        };
      }
      return null;
    }

    const separatorIndex = line.indexOf(':');
    if (separatorIndex <= 0) return null;
    const key = line.slice(0, separatorIndex).trim();
    if (!key || /[\[\]{}]/.test(key)) return null;
    const afterSeparator = line.slice(separatorIndex + 1);
    if (afterSeparator && !/^[ \t]/.test(afterSeparator)) return null;
    return { key, keyToken: line.slice(0, separatorIndex).trimEnd(), tail: afterSeparator.replace(/^[ \t]*/, '') };
  }

  private serializeOwnedProperty(key: string, value: unknown, newline: string, keyToken?: string): string {
    const serialized = stringifyYaml({ [key]: value }).trimEnd();
    const preservedKeyToken = String(keyToken || '').trim();
    const withPreservedKey = preservedKeyToken
      ? serialized.replace(/^[^:\r\n]+(?=:)/, preservedKeyToken)
      : serialized;
    return withPreservedKey.replace(/\n/g, newline);
  }

  private partitionByStorageType(files: TFile[]): { markdownFiles: TFile[]; nonMarkdownFiles: TFile[] } {
    const markdownFiles: TFile[] = [];
    const nonMarkdownFiles: TFile[] = [];
    for (const file of files || []) {
      if (!(file instanceof TFile) || this.plugin.filePropertiesService?.isCompanionFile(file)) continue;
      if (file.extension.toLowerCase() === 'md') {
        markdownFiles.push(file);
      } else if (this.plugin.filePropertiesService?.isPropertyTarget(file)) {
        nonMarkdownFiles.push(file);
      }
    }
    return { markdownFiles, nonMarkdownFiles };
  }

  private async applyToFiles(files: TFile[], mutator: FrontmatterMutator, cause: FilePropertiesMutationCause): Promise<TFile[]> {
    const updated: TFile[] = [];
    for (const file of files) {
      try {
        if (await this.process(file, mutator, cause)) {
          updated.push(file);
        }
      } catch (error) {
        logger.error('[TPS GCM] Frontmatter mutation failed', { file: file.path, error });
      }
    }
    return updated;
  }

  private async warnIfSchedulingMultiDateTaskContainer(files: TFile[], updates: Record<string, unknown>): Promise<void> {
    const scheduledEntry = Object.entries(updates).find(([key]) => key.trim().toLowerCase() === 'scheduled');
    if (!scheduledEntry) return;
    const targetDay = this.extractIsoDay(scheduledEntry[1]);
    if (!targetDay) return;

    for (const file of files) {
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') continue;
      const warningKey = `${file.path}:${targetDay}`;
      if (this.warnedPaths.has(warningKey)) continue;
      const content = await this.plugin.app.vault.cachedRead(file);
      const taskDays = this.extractScheduledTaskDays(content);
      const outsideDays = [...taskDays].filter((day) => day !== targetDay);
      if (taskDays.size <= 1 || outsideDays.length === 0) continue;
      this.warnedPaths.add(warningKey);
      new Notice(
        `Scheduling "${file.basename}" for ${targetDay}, but it contains tasks scheduled on ${outsideDays.slice(0, 3).join(', ')}${outsideDays.length > 3 ? '...' : ''}. This looks like a multi-day task storage note.`,
        10000,
      );
      logger.warn('[TPS GCM] Scheduling a note that contains scheduled tasks on other days', {
        file: file.path,
        targetDay,
        taskDays: [...taskDays],
      });
    }
  }

  private extractScheduledTaskDays(content: string): Set<string> {
    const days = new Set<string>();
    for (const line of content.split('\n')) {
      if (!/^\s*[-*]\s+\[[^\]]*\]\s+/.test(line)) continue;
      const match = line.match(/\[scheduled::\s*(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\s*\]/i);
      if (match?.[1]) days.add(match[1]);
    }
    return days;
  }

  private extractIsoDay(value: unknown): string | null {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    const text = String(value ?? '').trim();
    const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] ?? null;
  }

  private async runSerialized(file: TFile, action: () => Promise<void>): Promise<void> {
    const key = file.path;
    const previous = this.writeChains.get(key) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queued = previous.then(() => current).catch(() => current);
    this.writeChains.set(key, queued);

    try {
      await previous;
      await action();
    } finally {
      release();
      if (this.writeChains.get(key) === queued) {
        this.writeChains.delete(key);
      }
    }
  }

  private async readNormalized(file: TFile): Promise<{ bom: string; content: string; fullContent: string } | null> {
    try {
      const fullContent = await this.plugin.app.vault.read(file);
      const normalized = fullContent.replace(/\r\n/g, '\n');
      if (!normalized) {
        return { bom: '', content: '', fullContent: normalized };
      }
      if (normalized.startsWith('\uFEFF')) {
        return { bom: '\uFEFF', content: normalized.slice(1), fullContent: normalized };
      }
      return { bom: '', content: normalized, fullContent: normalized };
    } catch (error) {
      logger.warn('[TPS GCM] Failed reading file for frontmatter mutation', { file: file.path, error });
      return null;
    }
  }

  private async writeContent(file: TFile, nextContent: string): Promise<void> {
    const started = performance.now();
    await this.plugin.app.vault.modify(file, nextContent);
    logger.perf('frontmatterMutation.writeContent', {
      file: file.path,
      mode: 'vault.modify',
      durationMs: Math.round(performance.now() - started),
    });
  }

  private async readParsedWithRetries(file: TFile): Promise<{
    normalized: { bom: string; content: string; fullContent: string };
    parsed:
      | { ok: true; frontmatter: FrontmatterRecord; body: string }
      | { ok: false; reason: string; error?: unknown };
  } | null> {
    let last: {
      normalized: { bom: string; content: string; fullContent: string };
      parsed:
        | { ok: true; frontmatter: FrontmatterRecord; body: string }
        | { ok: false; reason: string; error?: unknown };
    } | null = null;

    for (let attemptIndex = 0; attemptIndex <= FrontmatterMutationService.PARSE_RETRY_DELAYS_MS.length; attemptIndex++) {
      const normalized = await this.readNormalized(file);
      if (!normalized) return null;

      let parsed:
        | { ok: true; frontmatter: FrontmatterRecord; body: string }
        | { ok: false; reason: string; error?: unknown };
      try {
        parsed = this.parseFrontmatterDocument(normalized.content);
      } catch (error) {
        parsed = { ok: false, reason: 'yaml-parse-failed', error };
      }

      if (parsed.ok) {
        if (attemptIndex > 0) {
          logger.debug('[TPS GCM] Frontmatter parse recovered after retry', {
            file: file.path,
            attempts: attemptIndex + 1,
          });
        }
        return { normalized, parsed };
      }

      last = { normalized, parsed };
      const delay = FrontmatterMutationService.PARSE_RETRY_DELAYS_MS[attemptIndex];
      if (delay == null) break;
      await this.sleep(delay);
    }

    return last;
  }

  private parseFrontmatterDocument(content: string):
    | { ok: true; frontmatter: FrontmatterRecord; body: string }
    | { ok: false; reason: string; error?: unknown } {
    const split = this.splitFrontmatterDocument(content);
    if (split.ok !== true) {
      return { ok: false, reason: split.reason };
    }
    if (!split.frontmatterBlock) {
      return { ok: true, frontmatter: {}, body: split.body };
    }

    try {
      const parsed = this.parseYamlBlockWithDuplicateKeyRepair(split.frontmatterBlock);
      const frontmatter = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as FrontmatterRecord
        : {};
      return { ok: true, frontmatter, body: split.body };
    } catch (error) {
      return { ok: false, reason: 'yaml-parse-failed', error };
    }
  }

  private splitFrontmatterDocument(content: string):
    | { ok: true; frontmatterBlock: string | null; body: string }
    | { ok: false; reason: string } {
    const source = String(content || '').replace(/\r\n/g, '\n');
    const leadingWhitespace = source.match(/^[ \t\r\n]*/)?.[0] ?? '';
    const bodyStart = leadingWhitespace.length;
    const hasTopFrontmatter = source.startsWith('---\n');
    const hasWhitespacePaddedFrontmatter = !hasTopFrontmatter
      && bodyStart > 0
      && source.slice(bodyStart).startsWith('---\n')
      && !/\S/.test(leadingWhitespace);

    if (!hasTopFrontmatter && !hasWhitespacePaddedFrontmatter) {
      const nestedIndex = this.findLineDelimiter(source, 0);
      if (nestedIndex > 0) {
        const nested = this.readFrontmatterBlockAt(source, nestedIndex);
        if (nested && this.looksLikeYamlFrontmatter(nested.block)) {
          return { ok: false, reason: 'frontmatter-not-at-top' };
        }
      }
      return { ok: true, frontmatterBlock: null, body: source };
    }

    const start = hasTopFrontmatter ? 0 : bodyStart;
    const first = this.readFrontmatterBlockAt(source, start);
    if (!first) {
      return { ok: false, reason: 'unterminated-frontmatter' };
    }

    const body = source.slice(first.end);
    const bodyWithoutLeadingWhitespace = body.replace(/^[ \t\r\n]*/, '');
    if (bodyWithoutLeadingWhitespace.startsWith('---\n')) {
      const secondStart = source.length - bodyWithoutLeadingWhitespace.length;
      const second = this.readFrontmatterBlockAt(source, secondStart);
      if (second && this.looksLikeYamlFrontmatter(second.block)) {
        return { ok: false, reason: 'duplicate-frontmatter' };
      }
    }

    return { ok: true, frontmatterBlock: first.block, body };
  }

  private readFrontmatterBlockAt(content: string, start: number): { block: string; end: number } | null {
    if (!content.startsWith('---\n', start)) return null;
    const close = this.findLineDelimiter(content, start + 4);
    if (close < 0) return null;
    const lineEnd = content.indexOf('\n', close + 1);
    const end = lineEnd < 0 ? content.length : lineEnd + 1;
    return {
      block: content.slice(start + 4, close),
      end,
    };
  }

  private findLineDelimiter(content: string, fromIndex: number): number {
    const pattern = /(^|\n)(?:---|\.\.\.)[ \t]*(?=\n|$)/g;
    pattern.lastIndex = Math.max(0, fromIndex);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const delimiterStart = match.index + (match[1] ? 1 : 0);
      if (delimiterStart >= fromIndex) return delimiterStart;
      pattern.lastIndex = match.index + match[0].length;
    }
    return -1;
  }

  private looksLikeYamlFrontmatter(block: string): boolean {
    return String(block || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .some((line) => /^[A-Za-z0-9_"'.-]+\s*:/.test(line));
  }

  private validateNextContent(nextContent: string): { ok: true } | { ok: false; reason: string; error?: unknown } {
    const content = String(nextContent || '').replace(/^\uFEFF/, '');
    const parsed = this.parseFrontmatterDocument(content);
    if (!parsed.ok) return parsed;
    if (parsed.frontmatter && typeof parsed.frontmatter === 'object') {
      try {
        stringifyYaml(this.sortFrontmatter(parsed.frontmatter));
      } catch (error) {
        return { ok: false, reason: 'yaml-stringify-failed', error };
      }
    }
    return { ok: true };
  }

  private parseYamlBlockWithDuplicateKeyRepair(block: string): unknown {
    try {
      return parseYaml(block);
    } catch (error) {
      if (!this.isDuplicateYamlKeyError(error)) throw error;

      const repaired = this.removeDuplicateTopLevelYamlKeys(block);
      if (repaired === block) throw error;

      logger.warn('[TPS GCM] Repaired duplicate frontmatter keys before mutation', {
        error: error instanceof Error ? error.message : String(error),
      });
      return parseYaml(repaired);
    }
  }

  private isDuplicateYamlKeyError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error || '');
    return message.toLowerCase().includes('map keys must be unique');
  }

  private removeDuplicateTopLevelYamlKeys(block: string): string {
    const lines = String(block || '').replace(/\r\n/g, '\n').split('\n');
    const keySpans: Array<{ key: string; start: number; end: number }> = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] || '';
      const match = line.match(/^([^#\s][^:]*):(?:\s|$)/);
      if (!match) continue;

      let end = index + 1;
      while (end < lines.length && !/^([^#\s][^:]*):(?:\s|$)/.test(lines[end] || '')) {
        end += 1;
      }
      keySpans.push({ key: casefold(match[1]), start: index, end });
      index = end - 1;
    }

    if (keySpans.length === 0) return block;

    const lastSpanByKey = new Map<string, number>();
    keySpans.forEach((span, index) => lastSpanByKey.set(span.key, index));
    const duplicateLineRanges: Array<{ start: number; end: number }> = [];
    keySpans.forEach((span, index) => {
      if (lastSpanByKey.get(span.key) !== index) {
        duplicateLineRanges.push({ start: span.start, end: span.end });
      }
    });

    if (duplicateLineRanges.length === 0) return block;

    const output: string[] = [];

    for (let index = 0; index < lines.length; index++) {
      const duplicateRange = duplicateLineRanges.find((range) => index >= range.start && index < range.end);
      if (duplicateRange) {
        index = duplicateRange.end - 1;
        continue;
      }
      output.push(lines[index] || '');
    }

    return output.join('\n');
  }

  private sortFrontmatter(frontmatter: FrontmatterRecord): FrontmatterRecord {
    const ordered: FrontmatterRecord = {};
    const entries = Object.entries(frontmatter || {});
    const claimed = new Set<string>();
    const propertyKeys = (this.plugin.settings.properties || [])
      .map((property) => String(property?.key || '').trim())
      .filter(Boolean);

    for (const configuredKey of propertyKeys) {
      const match = entries.find(([key]) => casefold(key) === casefold(configuredKey));
      if (!match) continue;
      ordered[configuredKey] = match[1];
      claimed.add(casefold(match[0]));
    }

    const remainder = entries
      .filter(([key]) => !claimed.has(casefold(key)))
      .sort((left, right) => left[0].localeCompare(right[0], undefined, { sensitivity: 'base' }));

    for (const [key, value] of remainder) {
      ordered[key] = value;
    }

    return ordered;
  }

  private removeEmptyValuesChangedByMutation(frontmatter: FrontmatterRecord, originalFrontmatter: FrontmatterRecord): void {
    for (const [key, value] of Object.entries(frontmatter)) {
      if (!this.isEmptyFrontmatterValue(value)) continue;
      const originalKey = findKeyCaseInsensitive(originalFrontmatter, key);
      const existedAsEmpty = !!originalKey && this.isEmptyFrontmatterValue(originalFrontmatter[originalKey]);
      if (!existedAsEmpty) {
        delete frontmatter[key];
      }
    }
  }

  private isEmptyFrontmatterValue(value: unknown): boolean {
    return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
  }

  private normalizeDateTimeValues(frontmatter: FrontmatterRecord): void {
    const configuredDateKeys = (this.plugin.settings.properties || [])
      .filter((property) => String(property?.type || '').toLowerCase() === 'datetime')
      .map((property) => String(property?.key || '').trim())
      .filter(Boolean);
    const dateKeys = new Set(['scheduled', 'due', 'start', 'end', 'date', 'completedDate', ...configuredDateKeys].map(casefold));

    for (const [key, value] of Object.entries(frontmatter)) {
      if (!dateKeys.has(casefold(key))) continue;
      if (casefold(key) === 'completeddate') {
        const normalized = normalizeObsidianDateTimeValue(normalizeCompletedDateValue(value));
        if (normalized) {
          frontmatter[key] = normalized;
        } else {
          delete frontmatter[key];
        }
        continue;
      }
      if (Array.isArray(value)) {
        frontmatter[key] = value
          .map((entry) => normalizeObsidianDateTimeValue(entry))
          .filter(Boolean);
        continue;
      }
      const normalized = normalizeObsidianDateTimeValue(value);
      if (normalized) {
        frontmatter[key] = normalized;
      }
    }
  }

  private appendActivityEntryIfNeeded(frontmatter: FrontmatterRecord, originalFrontmatter: FrontmatterRecord): void {
    if (this.plugin.settings.enableActivityLog !== true) return;

    const activityKey = String(this.plugin.settings.activityLogPropertyKey || 'activity').trim() || 'activity';
    const changes = this.diffFrontmatterForActivity(originalFrontmatter, frontmatter, activityKey);
    if (changes.length === 0) return;

    const existingKey = findKeyCaseInsensitive(frontmatter, activityKey) || activityKey;
    const existing = frontmatter[existingKey];
    if (existing != null && !Array.isArray(existing)) {
      logger.warn('[TPS GCM] Activity log skipped because property is not a list', {
        key: existingKey,
      });
      return;
    }

    const entries = Array.isArray(existing) ? [...existing] : [];
    entries.push({
      type: 'frontmatter',
      source: 'tps-gcm',
      ts: this.currentActivityTimestamp(),
      changes,
    });

    const maxEntries = Number(this.plugin.settings.activityLogMaxEntries);
    const limit = Number.isFinite(maxEntries) && maxEntries > 0 ? Math.floor(maxEntries) : 200;
    frontmatter[existingKey] = entries.slice(-limit);
  }

  private diffFrontmatterForActivity(
    before: FrontmatterRecord,
    after: FrontmatterRecord,
    activityKey: string,
  ): ActivityChange[] {
    const trackedKeys = this.getTrackedActivityKeys(activityKey);
    if (trackedKeys.size === 0) return [];

    const ignored = new Set([
      casefold(activityKey),
      'activity',
      'archiveoriginalfolder',
      'datemodified',
      'dateModified'.toLowerCase(),
      casefold(String(this.plugin.settings.dateModifiedFrontmatterKey || '')),
    ].filter(Boolean));
    const beforeByKey = new Map(Object.entries(before).map(([key, value]) => [casefold(key), { key, value }]));
    const afterByKey = new Map(Object.entries(after).map(([key, value]) => [casefold(key), { key, value }]));
    const allKeys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
    const changes: ActivityChange[] = [];

    for (const foldedKey of Array.from(allKeys).sort()) {
      if (ignored.has(foldedKey)) continue;
      if (!trackedKeys.has(foldedKey)) continue;
      const previous = beforeByKey.get(foldedKey);
      const next = afterByKey.get(foldedKey);
      if (this.activityValuesEqual(previous?.value, next?.value)) continue;

      const displayKey = next?.key || previous?.key || foldedKey;
      changes.push(this.describeActivityChange(displayKey, previous?.value, next?.value));
    }

    return changes;
  }

  private getTrackedActivityKeys(activityKey: string): Set<string> {
    return new Set(
      String(this.plugin.settings.activityLogTrackedProperties || '')
        .split(/[,\n]/)
        .map((key) => casefold(key.trim()))
        .filter((key) => key && key !== casefold(activityKey)),
    );
  }

  private describeActivityChange(key: string, before: unknown, after: unknown): ActivityChange {
    if (Array.isArray(before) || Array.isArray(after)) {
      const previous = this.normalizeActivityList(before);
      const next = this.normalizeActivityList(after);
      const previousSet = new Set(previous.map((value) => casefold(String(value))));
      const nextSet = new Set(next.map((value) => casefold(String(value))));
      return {
        key,
        added: next.filter((value) => !previousSet.has(casefold(String(value)))).map((value) => this.summarizeActivityValue(value)),
        removed: previous.filter((value) => !nextSet.has(casefold(String(value)))).map((value) => this.summarizeActivityValue(value)),
      };
    }

    return {
      key,
      from: this.summarizeActivityValue(before),
      to: this.summarizeActivityValue(after),
    };
  }

  private activityValuesEqual(left: unknown, right: unknown): boolean {
    return stableActivityString(left) === stableActivityString(right);
  }

  private normalizeActivityList(value: unknown): unknown[] {
    if (Array.isArray(value)) return value.flatMap((entry) => Array.isArray(entry) ? entry : [entry]);
    return value == null ? [] : [value];
  }

  private summarizeActivityValue(value: unknown): unknown {
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value ?? null;
    if (value instanceof Date) return formatLocalIsoDateTime(value);
    if (Array.isArray(value)) {
      return value.slice(0, 20).map((entry) => this.summarizeActivityValue(entry));
    }
    if (typeof value === 'object') {
      return '[object]';
    }
    const text = String(value);
    return text.length > 240 ? `${text.slice(0, 237)}...` : text;
  }

  private currentActivityTimestamp(): string {
    const momentFactory = (window as any)?.moment;
    if (typeof momentFactory === 'function') {
      return momentFactory().format('YYYY-MM-DDTHH:mm:ss');
    }
    return new Date().toISOString().slice(0, 19);
  }

  private normalizeList(value: unknown): string[] {
    const source = Array.isArray(value) ? value : value == null ? [] : [value];
    return source
      .flatMap((entry) => Array.isArray(entry) ? entry : [entry])
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
  }

  private normalizeTagValues(frontmatter: FrontmatterRecord): void {
    for (const [key, value] of Object.entries(frontmatter || {})) {
      const normalizedKey = casefold(key);
      if (normalizedKey !== 'tags' && normalizedKey !== 'tag') continue;

      const normalized = normalizeTagList(value);
      if (normalized.length === 0) {
        delete frontmatter[key];
      } else {
        frontmatter[key] = normalized;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private hasSuspiciousBrokenSubitemLine(text: string): boolean {
    return String(text || '').split('\n').some((line) =>
      /^[ \t]*(?:[-*+]|\d+\.)\s+(?:\[[^\]]+]\s+)?\[\[$/.test(line.trimEnd()),
    );
  }

  private getOpenMarkdownViewForFile(file: TFile): MarkdownView | null {
    return this.getOpenMarkdownViewsForFile(file)[0] ?? null;
  }

  private getOpenMarkdownViewsForFile(file: TFile): MarkdownView[] {
    const leaves = [];
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      if (view.file?.path !== file.path) continue;
      leaves.push(leaf);
    }
    if (leaves.length === 0) return [];

    const activeLeaf = this.plugin.app.workspace.activeLeaf ?? null;
    const bestLeaf = pickBestMarkdownLeaf(leaves, activeLeaf);
    const orderedLeaves = bestLeaf
      ? [bestLeaf, ...leaves.filter((leaf) => leaf !== bestLeaf)]
      : leaves;

    return orderedLeaves
      .map((leaf) => getCompatibleMarkdownViewFromLeaf(leaf))
      .filter((view): view is MarkdownView => view instanceof MarkdownView);
  }

  private readViewData(view: MarkdownView): string {
    const anyView = view as any;
    const editor = anyView.editor;
    if (typeof editor?.getValue === 'function') {
      return String(editor.getValue() || '');
    }
    if (typeof anyView.getViewData === 'function') {
      const data = anyView.getViewData();
      if (typeof data === 'string') return data;
    }
    return String(anyView.data || '');
  }

  private readViewSource(view: MarkdownView): string | null {
    if (getViewMode(view) !== 'source') return null;
    const anyView = view as any;
    const editor = anyView.editor;
    if (typeof editor?.getValue === 'function') {
      return String(editor.getValue() || '');
    }
    return null;
  }

  private warnMalformed(file: TFile, reason: string, error?: unknown): void {
    if (!this.warnedPaths.has(file.path)) {
      this.warnedPaths.add(file.path);
      new Notice(`Skipped frontmatter write for "${file.path}" (${reason}).`);
    }
    const detail = error instanceof Error ? error.message : error == null ? '' : String(error);
    logger.warn(`[TPS GCM] Skipping malformed frontmatter mutation for ${file.path} (${reason})${detail ? `: ${detail}` : ''}`);
  }
}

function normalizeObsidianDateTimeValue(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatLocalIsoDateTime(value);
  }
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/<%[\s\S]*%>/.test(trimmed) || /\{\{[\s\S]*\}\}/.test(trimmed)) return trimmed;

  const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) return `${dateOnly[1]} 00:00:00`;

  const dateTime = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dateTime) {
    return `${dateTime[1]} ${dateTime[2].padStart(2, '0')}:${dateTime[3]}:${dateTime[4] ?? '00'}`;
  }

  const momentFactory = (window as any)?.moment;
  if (typeof momentFactory === 'function') {
    const parsed = momentFactory(trimmed, [
      'YYYY-MM-DDTHH:mm:ss',
      'YYYY-MM-DDTHH:mm',
      'YYYY-MM-DD HH:mm:ss',
      'YYYY-MM-DD HH:mm',
      'YYYY-MM-DD',
      'ddd, MMM D YYYY h:mma',
      'ddd, MMM D YYYY h.mm a',
      'ddd, MMM D YYYY h.mmA',
      'ddd, MMM D YYYY',
      'MMM D, YYYY h:mma',
      'MMM D, YYYY h:mm A',
      'MMM D, YYYY',
    ], true);
    if (parsed?.isValid?.()) {
      return parsed.format('YYYY-MM-DD HH:mm:ss');
    }
  }
  return trimmed;
}

function formatLocalIsoDateTime(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  const second = String(value.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function stableActivityString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return formatLocalIsoDateTime(value);
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((entry) => stableActivityString(entry)));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableActivityString(entry)]);
    return JSON.stringify(entries);
  }
  return String(value);
}

function readFrontmatterString(frontmatter: FrontmatterRecord, key: string): string {
  const normalized = key.trim().toLowerCase();
  const existingKey = Object.keys(frontmatter || {}).find((candidate) => candidate.trim().toLowerCase() === normalized);
  if (!existingKey) return '';
  const value = frontmatter[existingKey];
  return typeof value === 'string' ? value : String(value ?? '');
}

function compactStack(stack: string | undefined): string[] | undefined {
  if (!stack) return undefined;
  return stack
    .split('\n')
    .slice(2, 8)
    .map((line) => line.trim())
    .filter(Boolean);
}
