import { Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import { casefold, deleteValueCaseInsensitive, findKeyCaseInsensitive, setValueCaseInsensitive } from '../core';
import { normalizeTagList } from '../utils/tag-utils';

type CanvasFrontmatterRecord = Record<string, unknown>;
type CanvasFrontmatterMutator = (frontmatter: CanvasFrontmatterRecord) => void | Promise<void>;

/**
 * Bridges GCM canvas property reads/writes to Advanced Canvas.
 *
 * Advanced Canvas owns canvas metadata compatibility by patching Obsidian's
 * metadata cache and fileManager.processFrontMatter for `.canvas` files.
 * GCM deliberately avoids writing canvas JSON directly here.
 */
export class CanvasPropertiesService {
  private warnedAdvancedCanvasUnavailable = false;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  isCanvasFile(file: unknown): file is TFile {
    return file instanceof TFile && file.extension?.toLowerCase() === 'canvas';
  }

  isBridgeAvailable(): boolean {
    const advancedCanvas = this.getAdvancedCanvasPlugin();
    if (!advancedCanvas) return false;
    const compatibilityEnabled = this.getAdvancedCanvasCompatibilitySetting(advancedCanvas);
    return compatibilityEnabled !== false;
  }

  read(file: TFile): CanvasFrontmatterRecord {
    if (!this.isCanvasFile(file)) return {};
    return this.cloneFrontmatter(this.plugin.app.metadataCache.getFileCache(file)?.frontmatter);
  }

  async process(file: TFile, mutator: CanvasFrontmatterMutator): Promise<boolean> {
    if (!this.isCanvasFile(file)) return false;
    if (!this.ensureBridgeAvailable(file)) return false;

    const beforeFrontmatter = this.read(file);
    const nextFrontmatter = this.cloneFrontmatter(beforeFrontmatter);
    const before = JSON.stringify(this.sortFrontmatter(nextFrontmatter));

    await mutator(nextFrontmatter);
    this.normalizeTagValues(nextFrontmatter);
    this.removeEmptyValues(nextFrontmatter);

    const sorted = this.sortFrontmatter(nextFrontmatter);
    const after = JSON.stringify(sorted);
    if (before === after) return false;

    const writer = this.resolveFrontmatterWriter();
    if (!writer) {
      logger.warn('[TPS GCM] Advanced Canvas bridge could not find a canvas frontmatter writer', { file: file.path });
      return false;
    }

    await writer(file, (frontmatter: CanvasFrontmatterRecord) => {
      for (const key of Object.keys(frontmatter || {})) delete frontmatter[key];
      Object.assign(frontmatter, sorted);
    });

    if (!(await this.waitForCanvasMetadata(file, sorted))) {
      logger.warn('[TPS GCM] Advanced Canvas bridge did not persist canvas metadata; applying compatibility fallback', { file: file.path });
      await this.writeCanvasMetadataCompatibilityFallback(file, sorted);
      await this.waitForCanvasMetadata(file, sorted);
    }

    this.plugin.eventService?.emitExplicitAction?.([file.path], { source: 'advanced-canvas-properties' });
    this.plugin.eventService?.emitFilesUpdated?.([file.path], { sourcePluginId: this.plugin.manifest.id });
    this.plugin.app.workspace.trigger('tps:gcm-canvas-properties-updated', file, sorted);
    return true;
  }

  async updateValues(files: TFile[], updates: Record<string, unknown>): Promise<TFile[]> {
    return this.applyToFiles(files, async (frontmatter) => {
      for (const [key, value] of Object.entries(updates || {})) {
        if (value === undefined || value === null) {
          deleteValueCaseInsensitive(frontmatter, key);
        } else {
          setValueCaseInsensitive(frontmatter, key, value);
        }
      }
    });
  }

  async setListValues(files: TFile[], key: string, values: unknown[]): Promise<TFile[]> {
    return this.applyToFiles(files, async (frontmatter) => {
      const normalized = this.normalizeList(values);
      if (normalized.length === 0) {
        deleteValueCaseInsensitive(frontmatter, key);
      } else {
        setValueCaseInsensitive(frontmatter, key, normalized);
      }
    });
  }

  async addValuesToList(files: TFile[], key: string, values: unknown[]): Promise<TFile[]> {
    const additions = this.normalizeList(values);
    if (additions.length === 0) return [];
    return this.applyToFiles(files, async (frontmatter) => {
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
    });
  }

  async removeValuesFromList(files: TFile[], key: string, values: unknown[]): Promise<TFile[]> {
    const removals = new Set(this.normalizeList(values).map((value) => casefold(String(value))));
    if (removals.size === 0) return [];
    return this.applyToFiles(files, async (frontmatter) => {
      const existingKey = findKeyCaseInsensitive(frontmatter, key);
      if (!existingKey) return;
      const current = this.normalizeList(frontmatter[existingKey]);
      const filtered = current.filter((value) => !removals.has(casefold(String(value))));
      if (filtered.length === 0) delete frontmatter[existingKey];
      else setValueCaseInsensitive(frontmatter, existingKey, filtered);
    });
  }

  async deleteKeys(files: TFile[], keys: string[]): Promise<TFile[]> {
    const normalizedKeys = keys.map((key) => String(key || '').trim()).filter(Boolean);
    if (normalizedKeys.length === 0) return [];
    return this.applyToFiles(files, async (frontmatter) => {
      for (const key of normalizedKeys) deleteValueCaseInsensitive(frontmatter, key);
    });
  }

  private async applyToFiles(files: TFile[], mutator: CanvasFrontmatterMutator): Promise<TFile[]> {
    const updated: TFile[] = [];
    for (const file of files) {
      if (!this.isCanvasFile(file)) continue;
      try {
        if (await this.process(file, mutator)) updated.push(file);
      } catch (error) {
        logger.error('[TPS GCM] Advanced Canvas property mutation failed', { file: file.path, error });
      }
    }
    return updated;
  }

  private getAdvancedCanvasPlugin(): any | null {
    const plugins = (this.plugin.app as any)?.plugins;
    const enabled = plugins?.enabledPlugins;
    const isEnabled = typeof enabled?.has === 'function'
      ? enabled.has('advanced-canvas')
      : Array.isArray(enabled)
        ? enabled.includes('advanced-canvas')
        : Boolean(plugins?.plugins?.['advanced-canvas']);
    return isEnabled ? plugins?.plugins?.['advanced-canvas'] ?? null : null;
  }

  private getAdvancedCanvasCompatibilitySetting(advancedCanvas: any): unknown {
    const settings = advancedCanvas?.settings;
    if (typeof settings?.getSetting === 'function') {
      return settings.getSetting('canvasMetadataCompatibilityEnabled');
    }
    return settings?.canvasMetadataCompatibilityEnabled;
  }

  private resolveFrontmatterWriter(): ((
    file: TFile,
    mutator: (frontmatter: CanvasFrontmatterRecord) => void,
  ) => Promise<unknown>) | null {
    const fileManager = this.plugin.app.fileManager as any;
    const current = fileManager?.processFrontMatter;
    if (typeof current === 'function' && current.__tpsGcmFrontmatterPatch !== true) {
      return async (file, mutator) => await current.call(fileManager, file, mutator);
    }

    const delegate = this.plugin.processFrontmatterWithNativeDelegate;
    if (typeof delegate === 'function') {
      return async (file, mutator) => await delegate.call(this.plugin, file, mutator);
    }

    return null;
  }

  private ensureBridgeAvailable(file: TFile): boolean {
    if (this.isBridgeAvailable()) return true;
    if (!this.warnedAdvancedCanvasUnavailable) {
      this.warnedAdvancedCanvasUnavailable = true;
      new Notice('Advanced Canvas metadata compatibility is required to edit canvas properties from GCM.');
    }
    logger.warn('[TPS GCM] Advanced Canvas bridge unavailable for canvas property write', { file: file.path });
    return false;
  }

  private cloneFrontmatter(value: unknown): CanvasFrontmatterRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return { ...(value as CanvasFrontmatterRecord) };
  }

  private normalizeList(values: unknown): unknown[] {
    const source = Array.isArray(values) ? values : values == null ? [] : [values];
    return source
      .map((value) => typeof value === 'string' ? value.trim() : value)
      .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');
  }

  private normalizeTagValues(frontmatter: CanvasFrontmatterRecord): void {
    for (const key of ['tags', 'tag']) {
      const actual = findKeyCaseInsensitive(frontmatter, key);
      if (!actual) continue;
      const normalized = normalizeTagList(frontmatter[actual]);
      if (normalized.length === 0) delete frontmatter[actual];
      else frontmatter[actual] = normalized;
    }
  }

  private removeEmptyValues(frontmatter: CanvasFrontmatterRecord): void {
    for (const [key, value] of Object.entries(frontmatter)) {
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
        delete frontmatter[key];
      }
    }
  }

  private sortFrontmatter(frontmatter: CanvasFrontmatterRecord): CanvasFrontmatterRecord {
    const ordered: CanvasFrontmatterRecord = {};
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

    for (const [key, value] of remainder) ordered[key] = value;
    return ordered;
  }

  private async waitForCanvasMetadata(file: TFile, expected: CanvasFrontmatterRecord): Promise<boolean> {
    const expectedJson = JSON.stringify(expected);
    for (const delayMs of [0, 40, 120, 250]) {
      if (delayMs > 0) await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      const current = this.read(file);
      if (JSON.stringify(this.sortFrontmatter(current)) === expectedJson) return true;
      const persisted = await this.readPersistedCanvasFrontmatter(file);
      if (JSON.stringify(this.sortFrontmatter(persisted)) === expectedJson) return true;
    }
    return false;
  }

  private async readPersistedCanvasFrontmatter(file: TFile): Promise<CanvasFrontmatterRecord> {
    try {
      const content = JSON.parse(await this.plugin.app.vault.read(file) || '{}');
      return this.cloneFrontmatter(content?.metadata?.frontmatter);
    } catch {
      return {};
    }
  }

  private async writeCanvasMetadataCompatibilityFallback(file: TFile, frontmatter: CanvasFrontmatterRecord): Promise<void> {
    await this.plugin.app.vault.process(file, (data) => {
      const content = JSON.parse(data || '{}');
      if (!content || typeof content !== 'object' || Array.isArray(content)) {
        throw new Error('Canvas file did not contain an object document.');
      }
      const document = content as Record<string, unknown>;
      const currentMetadata = document.metadata;
      const metadata = currentMetadata && typeof currentMetadata === 'object' && !Array.isArray(currentMetadata)
        ? currentMetadata as Record<string, unknown>
        : {};
      if (metadata.version == null) metadata.version = '1.0';
      metadata.frontmatter = { ...frontmatter };
      document.metadata = metadata;
      return `${JSON.stringify(document, null, 2)}\n`;
    });
  }
}
