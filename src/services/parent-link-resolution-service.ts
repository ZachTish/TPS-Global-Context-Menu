import { TFile, normalizePath } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { buildParentFrontmatterLinkValue, extractLinkTarget, resolveLinkValueToFile } from '../handlers/parent-link-format';
import type { ParentLinkKind, RelationshipSideRemovalOutcome, ResolvedParentLink } from './subitem-types';
import { didFrontmatterMutationChange, isFrontmatterMutationReady } from './frontmatter-mutation-outcome';
import * as logger from '../logger';

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

  getAllFileTargets(): TFile[] {
    return this.plugin.app.vault.getAllLoadedFiles().filter((file): file is TFile => file instanceof TFile);
  }

  getParentsForChild(childFile: TFile): ResolvedParentLink[] {
    const frontmatter = (this.plugin.app.metadataCache.getFileCache(childFile)?.frontmatter || {}) as Record<string, unknown>;
    return this.resolveParentsFromFrontmatter(childFile, frontmatter);
  }

  async getParentsForChildAuthoritatively(childFile: TFile): Promise<ResolvedParentLink[] | null> {
    let parents: ResolvedParentLink[] = [];
    const outcome = await this.plugin.frontmatterMutationService.processGuardedWithOutcome(childFile, (frontmatter) => {
      parents = this.resolveParentsFromFrontmatter(childFile, frontmatter as Record<string, unknown>);
      return 'unchanged';
    });
    return isFrontmatterMutationReady(outcome) ? parents : null;
  }

  private resolveParentsFromFrontmatter(
    childFile: TFile,
    frontmatter: Record<string, unknown>,
  ): ResolvedParentLink[] {
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
    const key = this.getParentKey();
    const linkValue = buildParentFrontmatterLinkValue(this.plugin.app, parentFile, childFile.path);

    let relationAdded = false;
    const childOutcome = await this.plugin.frontmatterMutationService.processGuardedWithOutcome(childFile, (fm) => {
      const values = this.getParentValuesFromFrontmatter(fm as Record<string, unknown>);
      const existingFiles = this.resolveFilesFromFrontmatterValue(values, childFile.path);
      const alreadyLinked = existingFiles.some((file) => file.path === parentFile.path);
      relationAdded = !alreadyLinked;

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

      if (alreadyLinked && exactUnchanged && !hasAliasKey) return 'unchanged';

      this.deleteParentAliasKeys(fm as Record<string, unknown>);
      this.setCaseInsensitive(fm as Record<string, unknown>, key, deduped);
      return true;
    });

    if (!isFrontmatterMutationReady(childOutcome)) return false;
    try {
      await this.ensureSelfLinkForParent(parentFile);
    } catch (error) {
      logger.warn('[TPS GCM] Child parent link committed but optional parent self-link failed', {
        child: childFile.path,
        parent: parentFile.path,
        error: logger.errorSummary(error),
      });
    }
    return relationAdded && didFrontmatterMutationChange(childOutcome);
  }

  async ensureSelfLinkForParent(parentFile: TFile): Promise<boolean> {
    if (!this.plugin.settings.autoSelfLinkParentInParentKey) return false;
    if (!(parentFile instanceof TFile) || parentFile.extension?.toLowerCase() !== 'md') return false;

    const key = this.getParentKey();
    const selfLink = buildParentFrontmatterLinkValue(this.plugin.app, parentFile, parentFile.path);

    const outcome = await this.plugin.frontmatterMutationService.processGuardedWithOutcome(parentFile, (fm) => {
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
      if (hasSelf && exactUnchanged && !hasAliasKey) return 'unchanged';

      this.deleteParentAliasKeys(fm as Record<string, unknown>);
      this.setCaseInsensitive(fm as Record<string, unknown>, key, deduped);
      return true;
    });
    return didFrontmatterMutationChange(outcome);
  }

  async removeParentFromChild(childFile: TFile, parentFile: TFile): Promise<boolean> {
    return (await this.removeParentFromChildWithOutcome(childFile, parentFile)) === 'removed';
  }

  async removeParentFromChildWithOutcome(
    childFile: TFile,
    parentFile: TFile,
  ): Promise<RelationshipSideRemovalOutcome> {
    const key = this.getParentKey();
    let relationPresent = false;

    const outcome = await this.plugin.frontmatterMutationService.processGuardedWithOutcome(childFile, (fm) => {
      relationPresent = false;
      const values = this.getParentValuesFromFrontmatter(fm as Record<string, unknown>);
      if (!values.length) return 'unchanged';
      if (values.some((value) => this.unresolvedValueMayReferenceFile(value, childFile.path, parentFile))) {
        return false;
      }
      const filtered = values.filter((value) => !this.valueMatchesFile(value, childFile.path, parentFile));
      relationPresent = filtered.length !== values.length;
      if (!relationPresent) return 'unchanged';
      this.deleteParentAliasKeys(fm as Record<string, unknown>);
      if (filtered.length > 0) {
        (fm as Record<string, unknown>)[key] = filtered;
      }
      return true;
    });
    if (!isFrontmatterMutationReady(outcome)) return 'refused';
    return relationPresent && didFrontmatterMutationChange(outcome) ? 'removed' : 'absent';
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

  private unresolvedValueMayReferenceFile(value: string, sourcePath: string, targetFile: TFile): boolean {
    if (resolveLinkValueToFile(this.plugin.app, value, sourcePath) instanceof TFile) return false;
    const target = extractLinkTarget(value);
    if (!target) return false;
    const normalizedTarget = normalizePath(target).replace(/\.md$/i, '').toLowerCase();
    const normalizedPath = normalizePath(targetFile.path).replace(/\.md$/i, '').toLowerCase();
    return normalizedTarget === normalizedPath || normalizedTarget === targetFile.basename.toLowerCase();
  }

  private setCaseInsensitive(frontmatter: Record<string, unknown>, key: string, value: unknown): void {
    const existingKey = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (existingKey && existingKey !== key) delete frontmatter[existingKey];
    frontmatter[key] = value;
  }

}
