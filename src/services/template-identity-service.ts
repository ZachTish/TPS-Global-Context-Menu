import { getAllTags, normalizePath, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import type { TpsTemplateIdentificationMode, TpsTemplatePropertyMatch } from '../types';

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
    return mode === 'tag' || mode === 'property' ? mode : 'templater-folder';
  }

  matches(file: TFile): boolean {
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') return false;
    const mode = this.getMode();
    if (mode === 'tag') return this.matchesTag(file);
    if (mode === 'property') return this.matchesProperty(file);
    return this.matchesTemplaterFolder(file);
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
    if (!folder) return true;
    const path = normalizePath(file.path);
    return path.startsWith(`${folder}/`);
  }

  private matchesTag(file: TFile): boolean {
    const wanted = normalizeToken(this.plugin.settings.templateIdentificationTag).replace(/^#+/, '');
    if (!wanted) return false;
    const tags = getAllTags(this.plugin.app.metadataCache.getFileCache(file)) ?? [];
    return tags.some((tag) => normalizeToken(tag).replace(/^#+/, '') === wanted);
  }

  private matchesProperty(file: TFile): boolean {
    const key = String(this.plugin.settings.templateIdentificationPropertyKey ?? '').trim();
    const wanted = normalizeToken(this.plugin.settings.templateIdentificationPropertyValue);
    if (!key || !wanted) return false;
    const value = readPropertyCaseInsensitive(
      this.plugin.app.metadataCache.getFileCache(file)?.frontmatter,
      key,
    );
    const match: TpsTemplatePropertyMatch = this.plugin.settings.templateIdentificationPropertyMatch === 'contains'
      ? 'contains'
      : 'equals';
    return scalarValues(value).some((candidate) => (
      match === 'contains' ? candidate.includes(wanted) : candidate === wanted
    ));
  }
}
