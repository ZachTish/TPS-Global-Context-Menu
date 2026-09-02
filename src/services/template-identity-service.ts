import { normalizePath, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import type { TpsTemplateIdentificationMode, TpsTemplatePropertyMatch } from '../types';
import {
  canAutomaticallyMutateTemplateFile,
  canAutomaticallyMutateTemplateSource,
  inspectTemplateProtectionFrontmatter,
  inspectTemplateProtectionSource,
  stripTemplateProtectionTagFromSource,
} from '../utils/template-protection';

function normalizeToken(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function readPropertyCaseInsensitive(frontmatter: unknown, key: string): unknown {
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return undefined;
  const wanted = normalizeToken(key);
  if (!wanted) return undefined;
  for (const [candidate, value] of Object.entries(frontmatter as Record<string, unknown>)) {
    if (normalizeToken(candidate) === wanted) return value;
  }
  return undefined;
}

function scalarValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => scalarValues(entry));
  if (value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [normalizeToken(value)];
  }
  return [];
}

export class TemplateIdentityService {
  readonly version = 1;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  getMode(): TpsTemplateIdentificationMode {
    const mode = this.plugin.settings.templateIdentificationMode;
    return mode === 'templater-folder' || mode === 'property' ? mode : 'tag';
  }

  matches(file: TFile): boolean {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') return false;
    const mode = this.getMode();
    if (mode === 'tag') return this.matchesTag(file);
    if (mode === 'property') return this.matchesProperty(file);
    return this.matchesTemplaterFolder(file);
  }

  /**
   * Mutation-boundary contract for other TPS plugins. Tag identity is checked
   * against current Vault bytes and fails closed when those bytes cannot be
   * verified; the path/property compatibility modes retain their established
   * identity semantics.
   */
  async canAutomaticallyMutate(file: TFile): Promise<boolean> {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') return false;
    if (this.getMode() === 'tag') {
      return canAutomaticallyMutateTemplateFile(
        this.plugin.app.vault,
        file,
        this.plugin.settings,
      );
    }
    return !this.matches(file);
  }

  /** Current-source recheck for consumers already inside an atomic raw write. */
  canAutomaticallyMutateSource(source: string): boolean {
    if (this.getMode() !== 'tag') return true;
    return canAutomaticallyMutateTemplateSource(source, this.plugin.settings);
  }

  /** Parsed-frontmatter recheck for consumers inside processFrontMatter. */
  canAutomaticallyMutateFrontmatter(frontmatter: unknown): boolean {
    const mode = this.getMode();
    if (mode === 'tag') {
      return inspectTemplateProtectionFrontmatter(frontmatter, this.plugin.settings) === 'unprotected';
    }
    if (mode === 'property') return !this.matchesPropertyFrontmatter(frontmatter);
    return true;
  }

  /**
   * Prepare bytes copied from a template into a new note. Tag mode removes
   * only the exact identity marker and verifies that it is gone; malformed
   * frontmatter is rejected instead of copied as a still-protected instance.
   */
  prepareInstanceSource(source: string): string | null {
    const raw = String(source ?? '');
    if (this.getMode() !== 'tag') return raw;
    const inspection = inspectTemplateProtectionSource(raw, this.plugin.settings);
    if (inspection === 'unsafe') return null;
    if (inspection === 'unprotected') return raw;
    const prepared = stripTemplateProtectionTagFromSource(raw, this.plugin.settings);
    return inspectTemplateProtectionSource(prepared, this.plugin.settings) === 'unprotected'
      ? prepared
      : null;
  }

  list(): TFile[] {
    return this.plugin.app.vault.getMarkdownFiles()
      .filter((file) => this.matches(file))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private matchesTemplaterFolder(file: TFile): boolean {
    const templater = (this.plugin.app as any)?.plugins?.getPlugin?.('templater-obsidian')
      ?? (this.plugin.app as any)?.plugins?.plugins?.['templater-obsidian'];
    const rawFolder = String(templater?.settings?.templates_folder ?? '').trim();
    const folder = normalizePath(rawFolder).replace(/^\/+|\/+$/g, '');
    if (!folder) return false;
    const path = normalizePath(file.path);
    return path.startsWith(`${folder}/`);
  }

  private matchesTag(file: TFile): boolean {
    return inspectTemplateProtectionFrontmatter(
      this.plugin.app.metadataCache.getFileCache(file)?.frontmatter,
      this.plugin.settings,
    ) === 'protected';
  }

  private matchesProperty(file: TFile): boolean {
    return this.matchesPropertyFrontmatter(
      this.plugin.app.metadataCache.getFileCache(file)?.frontmatter,
    );
  }

  private matchesPropertyFrontmatter(frontmatter: unknown): boolean {
    const key = String(this.plugin.settings.templateIdentificationPropertyKey ?? '').trim();
    const wanted = normalizeToken(this.plugin.settings.templateIdentificationPropertyValue);
    if (!key || !wanted) return false;
    const value = readPropertyCaseInsensitive(frontmatter, key);
    const match: TpsTemplatePropertyMatch = this.plugin.settings.templateIdentificationPropertyMatch === 'contains'
      ? 'contains'
      : 'equals';
    return scalarValues(value).some((candidate) => (
      match === 'contains' ? candidate.includes(wanted) : candidate === wanted
    ));
  }
}
