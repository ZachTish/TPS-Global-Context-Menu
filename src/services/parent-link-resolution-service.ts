import { TFile, normalizePath } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { buildParentFrontmatterLinkValue, resolveLinkValueToFile } from '../handlers/parent-link-format';
import type { ParentLinkKind, ResolvedParentLink } from './subitem-types';
import {
  matchesParentChildIgnoreRule,
  type ParentChildIgnoreSettings,
} from './parent-child-ignore-service';

export class ParentLinkResolutionService {
  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  getParentKey(): string {
    return String(this.plugin.settings.parentLinkFrontmatterKey || 'parent').trim() || 'parent';
  }

  getParentKind(file: TFile): ParentLinkKind {
    const ext = String(file.extension || '').trim().toLowerCase();
    if (ext === 'md') return 'markdown-parent';
    if (ext === 'base') return 'base-parent';
    return 'other-parent';
  }

  /**
   * Resolve the frontmatter that belongs to the logical vault item. Markdown
   * reads its own cache; every supported non-Markdown item reads its GCM
   * companion without exposing the companion as a relationship candidate.
   */
  getLogicalFrontmatter(file: TFile): Record<string, unknown> {
    if (!(file instanceof TFile)) return {};
    if (this.plugin.filePropertiesService?.isCompanionFile(file)) return {};
    if (this.plugin.filePropertiesService?.isPropertyTarget(file)) {
      return this.plugin.filePropertiesService.read(file) as Record<string, unknown>;
    }
    return (this.plugin.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, unknown>;
  }

  isRelationshipTarget(file: unknown): file is TFile {
    if (!(file instanceof TFile)) return false;
    if (this.plugin.filePropertiesService?.isCompanionFile(file)) return false;
    return String(file.extension || '').trim().toLowerCase() === 'md'
      || this.plugin.filePropertiesService?.isPropertyTarget(file) === true;
  }

  /** Enumerate logical relationship targets; managed companion notes stay hidden. */
  getRelationshipCandidates(options: { includeIgnored?: boolean } = {}): TFile[] {
    return this.plugin.app.vault.getAllLoadedFiles().filter(
      (file): file is TFile => this.isRelationshipTarget(file)
        && (options.includeIgnored === true || !this.isIgnoredFile(file)),
    );
  }

  getAllFileTargets(): TFile[] {
    return this.getRelationshipCandidates();
  }

  isIgnoredFrontmatter(frontmatter: Record<string, unknown> | null | undefined): boolean {
    return matchesParentChildIgnoreRule(
      frontmatter,
      this.plugin.settings as unknown as ParentChildIgnoreSettings,
    );
  }

  isIgnoredFile(file: TFile): boolean {
    if (!(file instanceof TFile)) return false;
    if (this.plugin.filePropertiesService?.isCompanionFile(file)) return true;
    return this.isIgnoredFrontmatter(this.getLogicalFrontmatter(file));
  }

  getParentsForChild(childFile: TFile): ResolvedParentLink[] {
    if (this.isIgnoredFile(childFile)) return [];
    return this.getStoredParentsForChild(childFile)
      .filter((entry) => !this.isIgnoredFile(entry.file));
  }

  /** Read persisted relationships without applying the display/automation ignore rule. */
  getStoredParentsForChild(childFile: TFile): ResolvedParentLink[] {
    const frontmatter = this.getLogicalFrontmatter(childFile);
    const values = this.getParentValuesFromFrontmatter(frontmatter);
    const results = new Map<string, ResolvedParentLink>();
    for (const file of this.resolveFilesFromFrontmatterValue(values, childFile.path)) {
      if (file.path === childFile.path) continue;
      results.set(file.path, {
        file,
        kind: this.getParentKind(file),
        source: 'child-frontmatter',
      });
    }
    return Array.from(results.values());
  }

  hasParent(childFile: TFile, parentFile: TFile): boolean {
    return this.getParentsForChild(childFile).some((entry) => entry.file.path === parentFile.path);
  }

  async addParentToChild(childFile: TFile, parentFile: TFile): Promise<boolean> {
    if (this.isIgnoredFile(childFile) || this.isIgnoredFile(parentFile)) return false;
    const key = this.getParentKey();
    const linkValue = buildParentFrontmatterLinkValue(this.plugin.app, parentFile, childFile.path);
    let changed = false;

    await this.plugin.frontmatterMutationService.process(childFile, (fm) => {
      if (this.isIgnoredFrontmatter(fm as Record<string, unknown>) || this.isIgnoredFile(parentFile)) return;
      const values = this.getParentValuesFromFrontmatter(fm as Record<string, unknown>);
      const existingFiles = this.resolveFilesFromFrontmatterValue(values, childFile.path);
      const alreadyLinked = existingFiles.some((file) => file.path === parentFile.path);

      if (!alreadyLinked) values.push(linkValue);

      const normalizedValues = values.map((value) => {
        const resolved = resolveLinkValueToFile(this.plugin.app, value, childFile.path);
        return resolved instanceof TFile
          ? buildParentFrontmatterLinkValue(this.plugin.app, resolved, childFile.path)
          : String(value || '').trim();
      });
      const deduped = this.dedupeValuesForSource(normalizedValues, childFile.path);
      const hasAliasKey = this.getParentKeyAliases().some((alias) => {
        if (alias.toLowerCase() === key.toLowerCase()) return false;
        return Object.keys(fm as Record<string, unknown>).some((candidate) => candidate.toLowerCase() === alias.toLowerCase());
      });
      const existingKey = Object.keys(fm as Record<string, unknown>).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      const existingRaw = existingKey ? (fm as Record<string, unknown>)[existingKey] : undefined;
      const existingExactValues = existingKey
        ? this.normalizeFrontmatterValues(existingRaw)
        : [];
      const exactUnchanged = Array.isArray(existingRaw)
        && existingExactValues.length === deduped.length
        && existingExactValues.every((value, index) => value === deduped[index]);

      if (alreadyLinked && exactUnchanged && !hasAliasKey) return;

      this.deleteParentAliasKeys(fm as Record<string, unknown>);
      this.setCaseInsensitive(fm as Record<string, unknown>, key, deduped);
      changed = true;
    });

    const selfChanged = await this.ensureSelfLinkForParent(parentFile);
    return changed || selfChanged;
  }

  async ensureSelfLinkForParent(parentFile: TFile): Promise<boolean> {
    if (!this.plugin.settings.autoSelfLinkParentInParentKey) return false;
    if (!(parentFile instanceof TFile) || parentFile.extension?.toLowerCase() !== 'md') return false;
    if (this.isIgnoredFile(parentFile)) return false;

    const key = this.getParentKey();
    const selfLink = buildParentFrontmatterLinkValue(this.plugin.app, parentFile, parentFile.path);
    let changed = false;

    await this.plugin.frontmatterMutationService.process(parentFile, (fm) => {
      if (this.isIgnoredFrontmatter(fm as Record<string, unknown>)) return;
      const values = this.getParentValuesFromFrontmatter(fm as Record<string, unknown>);
      const normalizedValues = values.map((value) => {
        const resolved = resolveLinkValueToFile(this.plugin.app, value, parentFile.path);
        return resolved instanceof TFile
          ? buildParentFrontmatterLinkValue(this.plugin.app, resolved, parentFile.path)
          : String(value || '').trim();
      }).filter(Boolean);

      const hasSelf = normalizedValues.some((value) => this.valueMatchesFile(value, parentFile.path, parentFile));
      if (!hasSelf) normalizedValues.push(selfLink);
      const deduped = this.dedupeValuesForSource(normalizedValues, parentFile.path);

      const existingKey = Object.keys(fm as Record<string, unknown>).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      const hasAliasKey = this.getParentKeyAliases().some((alias) => {
        if (alias.toLowerCase() === key.toLowerCase()) return false;
        return Object.keys(fm as Record<string, unknown>).some((candidate) => candidate.toLowerCase() === alias.toLowerCase());
      });
      const existingRaw = existingKey ? (fm as Record<string, unknown>)[existingKey] : undefined;
      const existingExactValues = existingKey ? this.normalizeFrontmatterValues(existingRaw) : [];
      const exactUnchanged = Array.isArray(existingRaw)
        && existingExactValues.length === deduped.length
        && existingExactValues.every((value, index) => value === deduped[index]);
      if (hasSelf && exactUnchanged && !hasAliasKey) return;

      this.deleteParentAliasKeys(fm as Record<string, unknown>);
      this.setCaseInsensitive(fm as Record<string, unknown>, key, deduped);
      changed = true;
    });

    return changed;
  }

  async removeParentFromChild(childFile: TFile, parentFile: TFile): Promise<boolean> {
    const key = this.getParentKey();
    let changed = false;

    await this.plugin.frontmatterMutationService.process(childFile, (fm) => {
      const values = this.getParentValuesFromFrontmatter(fm as Record<string, unknown>);
      if (!values.length) return;
      const filtered = values.filter((value) => !this.valueMatchesFile(value, childFile.path, parentFile));
      if (filtered.length === values.length) return;
      changed = true;
      this.deleteParentAliasKeys(fm as Record<string, unknown>);
      if (filtered.length === 0) {
        return;
      } else {
        (fm as Record<string, unknown>)[key] = filtered;
      }
    });

    return changed;
  }

  resolveFilesFromFrontmatterValue(value: unknown, sourcePath: string): TFile[] {
    const values = this.normalizeFrontmatterValues(value);
    const files = new Map<string, TFile>();
    for (const raw of values) {
      const resolved = resolveLinkValueToFile(this.plugin.app, raw, sourcePath);
      if (resolved instanceof TFile) {
        files.set(resolved.path, resolved);
      }
    }
    return Array.from(files.values());
  }

  private normalizeFrontmatterValues(value: unknown): string[] {
    const output: string[] = [];
    const visit = (current: unknown): void => {
      if (current == null) return;
      if (Array.isArray(current)) {
        current.forEach(visit);
        return;
      }
      if (typeof current === 'object') {
        Object.values(current as Record<string, unknown>).forEach(visit);
        return;
      }
      const raw = String(current || '').trim();
      if (raw) output.push(raw);
    };
    visit(value);
    return output;
  }

  private getParentValuesFromFrontmatter(frontmatter: Record<string, unknown>): string[] {
    const values: string[] = [];
    const seenKeys = new Set<string>();
    for (const key of this.getParentKeyAliases()) {
      const existingKey = Object.keys(frontmatter || {}).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (!existingKey || seenKeys.has(existingKey.toLowerCase())) continue;
      seenKeys.add(existingKey.toLowerCase());
      values.push(...this.normalizeFrontmatterValues(frontmatter[existingKey]));
    }
    return values;
  }

  private deleteParentAliasKeys(frontmatter: Record<string, unknown>): void {
    for (const key of this.getParentKeyAliases()) {
      const existingKey = Object.keys(frontmatter || {}).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (existingKey) delete frontmatter[existingKey];
    }
  }

  private getParentKeyAliases(): string[] {
    const canonical = this.getParentKey();
    return Array.from(new Set([canonical, 'parents', 'parent', 'childOf'].map((key) => key.trim()).filter(Boolean)));
  }

  private dedupeValuesForSource(values: string[], sourcePath: string): string[] {
    const exactSeen = new Set<string>();
    const fileSeen = new Set<string>();
    const deduped: string[] = [];
    for (const value of values) {
      const trimmed = String(value || '').trim();
      if (!trimmed) continue;
      const exactKey = trimmed.toLowerCase();
      const resolved = resolveLinkValueToFile(this.plugin.app, trimmed, sourcePath);
      if (resolved instanceof TFile) {
        const pathKey = normalizePath(resolved.path).toLowerCase();
        if (fileSeen.has(pathKey)) continue;
        fileSeen.add(pathKey);
      } else if (exactSeen.has(exactKey)) {
        continue;
      }
      exactSeen.add(exactKey);
      deduped.push(trimmed);
    }
    return deduped;
  }

  private valueMatchesFile(value: string, sourcePath: string, targetFile: TFile): boolean {
    const resolved = resolveLinkValueToFile(this.plugin.app, value, sourcePath);
    if (resolved instanceof TFile) {
      return normalizePath(resolved.path) === normalizePath(targetFile.path);
    }
    return normalizePath(String(value || '')) === normalizePath(targetFile.path);
  }

  private setCaseInsensitive(frontmatter: Record<string, unknown>, key: string, value: unknown): void {
    const existingKey = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (existingKey && existingKey !== key) delete frontmatter[existingKey];
    frontmatter[key] = value;
  }

}
