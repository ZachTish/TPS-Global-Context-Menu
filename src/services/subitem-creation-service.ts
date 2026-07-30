import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { buildParentFrontmatterLinkValue } from '../handlers/parent-link-format';
import { CreateSubitemModal } from '../modals/create-subitem-modal';
import { mergeNormalizedTags, parseTagInput } from '../utils/tag-utils';
import * as logger from '../logger';

export interface CreateSubitemOptions {
  seedParentTags?: boolean;
  seedVisualMetadata?: boolean;
  insertParentBodyLink?: boolean;
  inheritParentTemporalMetadata?: boolean;
  saveFolderPath?: boolean;
  targetPath?: string;
  frontmatterTitle?: string;
}

export async function promptAndCreateSubitemForParent(
  plugin: TPSGlobalContextMenuPlugin,
  parentFile: TFile,
  options?: CreateSubitemOptions,
): Promise<TFile | null> {
  if (parentFile.extension?.toLowerCase() !== 'md') {
    new Notice('Subitems can only be created under markdown notes.');
    return null;
  }

  const defaultFolderPath = getDefaultSubitemFolderPath(plugin, parentFile);
  const selection = await new Promise<{ title: string; folderPath: string } | null>((resolve) => {
    const modal = new CreateSubitemModal(plugin.app, getFolderPathOptions(plugin.app), defaultFolderPath, resolve);
    modal.open();
  });

  if (!selection) return null;
  return createSubitemForParentWithTitle(plugin, parentFile, selection.title, selection.folderPath, options);
}

export async function createSubitemForParentWithTitle(
  plugin: TPSGlobalContextMenuPlugin,
  parentFile: TFile,
  title: string,
  folderPathSelection?: string,
  options?: CreateSubitemOptions,
): Promise<TFile | null> {
  const cleanedTitle = sanitizeSubitemTitle(title);
  if (!cleanedTitle) {
    new Notice('Subitem title cannot be empty.');
    return null;
  }
  if (isMalformedSubitemTitle(cleanedTitle)) {
    new Notice('Subitem title looks malformed. Repair the parent checklist line first.');
    return null;
  }

  const requestedTargetPath = normalizeRequestedMarkdownPath(options?.targetPath);
  const requestedFolderPath = requestedTargetPath.includes('/')
    ? requestedTargetPath.slice(0, requestedTargetPath.lastIndexOf('/'))
    : '';
  const folderInput = requestedTargetPath
    ? requestedFolderPath || '/'
    : String(folderPathSelection ?? getDefaultSubitemFolderPath(plugin, parentFile) ?? '/').trim() || '/';
  const folderPath = folderInput === '/' ? '' : normalizePath(folderInput);
  if (folderPath) {
    await ensureFolderPath(plugin.app, folderPath);
  }

  const targetPath = requestedTargetPath || getUniqueMarkdownPath(plugin.app, folderPath, cleanedTitle);
  const existingTarget = plugin.app.vault.getAbstractFileByPath(targetPath);
  if (existingTarget instanceof TFile) return existingTarget;
  if (existingTarget) {
    new Notice('A non-note item already uses the requested task note path.');
    return null;
  }
  const displayTitle = String(options?.frontmatterTitle || cleanedTitle)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || cleanedTitle;
  const escapedTitle = displayTitle.replace(/"/g, '\\"');
  const parentLinkKey = plugin.parentLinkResolutionService.getParentKey();
  const parentLinkValue = buildParentFrontmatterLinkValue(
    plugin.app,
    parentFile,
    targetPath,
  ).replace(/"/g, '\\"');
  const seedParentTags = options?.seedParentTags ?? true;
  const seedVisualMetadata = options?.seedVisualMetadata === true;

  let isDailyNoteParent = false;
  let dailyNoteDateStr = '';
  if (plugin.fileNamingService.isDateOnlyBasename(parentFile.basename)) {
      isDailyNoteParent = true;
      const parsed = window.moment(parentFile.basename, [
          plugin.fileNamingService.getDailyNoteDateFormat(),
          "YYYY-MM-DD", "YYYY_MM_DD", "YYYYMMDD",
          "dddd, MMMM Do YYYY", "MMMM D, YYYY", "MMM D, YYYY"
      ], true);
      if (parsed.isValid()) {
          dailyNoteDateStr = parsed.format('YYYY-MM-DD 00:00:00');
      }
  }

  const frontmatterLines = [
    '---',
    `title: "${escapedTitle}"`,
    `${parentLinkKey}:`,
    `  - "${parentLinkValue}"`,
  ];
  if (options?.inheritParentTemporalMetadata !== false && isDailyNoteParent && dailyNoteDateStr) {
    frontmatterLines.push(`scheduled: ${dailyNoteDateStr}`);
  }
  if (options?.saveFolderPath === true || (options?.saveFolderPath !== false && plugin.settings.autoSaveFolderPath)) {
    frontmatterLines.push(`folderPath: "${(folderPath || '/').replace(/"/g, '\\"')}"`);
  }
  if (seedVisualMetadata) {
    const iconDefaults = resolveNewSubitemIconDefaults(plugin.app, parentFile, folderPath);
    if (iconDefaults.icon) {
      frontmatterLines.push(`icon: "${iconDefaults.icon.replace(/"/g, '\\"')}"`);
    }
    if (iconDefaults.iconColor) {
      const escapedColor = iconDefaults.iconColor.replace(/"/g, '\\"');
      frontmatterLines.push(`iconColor: "${escapedColor}"`);
      // Use color as an alias for iconColor to support both fields
      frontmatterLines.push(`color: "${escapedColor}"`);
    }
  }

  const parentCache = plugin.app.metadataCache.getFileCache(parentFile);
  const parentFrontmatter = (parentCache?.frontmatter || {}) as Record<string, any>;
  
  const beforeInheritedKeys = new Set(
    frontmatterLines
      .map((line) => line.split(':')[0]?.trim().toLowerCase())
      .filter((key): key is string => Boolean(key)),
  );
  if (options?.inheritParentTemporalMetadata !== false) {
    const inheritedLines = collectInheritedParentFrontmatterLines(parentFrontmatter, beforeInheritedKeys);
    frontmatterLines.push(...inheritedLines);
  }
  const parentTags = seedParentTags
    ? filterIgnoredSubitemTags(plugin, parseTagInput([parentFrontmatter.tags, parentFrontmatter.tag]))
    : [];
  if (seedParentTags && parentTags.length > 0) {
    const serializedTags = parentTags.map((tag) => `"${tag.replace(/"/g, '\\"')}"`).join(', ');
    frontmatterLines.push(`tags: [${serializedTags}]`);
  }

  const finalFrontmatterLines = dedupeFrontmatterLines(frontmatterLines);
  const initialContent = `${[...finalFrontmatterLines, '---', ''].join('\n')}\n`;

  let created: TFile;
  try {
    created = await plugin.app.vault.create(targetPath, initialContent);
  } catch (error) {
    const racedTarget = plugin.app.vault.getAbstractFileByPath(targetPath);
    if (racedTarget instanceof TFile) {
      logger.flow('SubitemCreate', 'create:race-recovered', {
        parentPath: parentFile.path,
        targetPath,
      });
      return racedTarget;
    }
    logger.error('[TPS GCM] Failed creating subitem:', error);
    new Notice('Failed to create subitem.');
    return null;
  }

  try {
    const hasStatus = finalFrontmatterLines.some((l) => l.trim().toLowerCase().startsWith('status:'));
    if (options?.insertParentBodyLink !== false) {
      await plugin.subitemRelationshipSyncService.insertBodyLink(parentFile, created, hasStatus ? '[ ]' : null);
    }
  } catch (error) {
    logger.error('[TPS GCM] Failed linking new subitem to parent:', error);
    new Notice('Created subitem, but failed to link to parent.');
  }

  if (plugin.settings.applyNotebookNavigatorRulesOnSubitemCreate) {
    await applyNotebookNavigatorRulesToFile(plugin, created);
  }

  if (seedParentTags && parentTags.length > 0) {
    await mergeParentTagsIntoSubitem(plugin, created, parentTags);
  }

  // The child was created with its parent link already in frontmatter. Avoid a
  // redundant immediate rewrite of a brand-new note while status sync
  // may also be settling metadata for the same file.

  new Notice(`Created subitem: ${created.basename}`);
  return created;
}

export function getDefaultSubitemFolderPath(plugin: TPSGlobalContextMenuPlugin, parentFile: TFile): string {
  return parentFile.parent?.path || '/';
}

export function getFolderPathOptions(app: App): string[] {
  const paths = new Set<string>(['/']);
  const folders = app.vault.getAllLoadedFiles().filter((item): item is TFolder => item instanceof TFolder);
  folders.forEach((folder) => paths.add(folder.path || '/'));
  return Array.from(paths.values()).sort((a, b) => {
    if (a === '/') return -1;
    if (b === '/') return 1;
    return a.localeCompare(b);
  });
}

export function sanitizeSubitemTitle(rawTitle: string): string {
  const cleaned = String(rawTitle || '')
    .replace(/\s*(?:<!--\s*tps-calendar\s+[\s\S]*?-->|\s*%%\s*tps-calendar\s+[\s\S]*?%%)/gi, '')
    .replace(/@@\{[^}]*\}/g, '')
    .replace(/@\{[^}]*\}/g, '')
    .replace(/[\[(][a-zA-Z0-9_-]+::\s*[^\]\)]+[\]\)]/g, '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 120 ? cleaned.slice(0, 120).trim() : cleaned;
}

function isMalformedSubitemTitle(title: string): boolean {
  const normalized = String(title || '').trim();
  if (!normalized) return false;
  return /^\[\[+$/.test(normalized);
}

function normalizeRequestedMarkdownPath(value: string | null | undefined): string {
  const raw = String(value || '').trim().replace(/^\/+/, '');
  if (!raw) return '';
  const normalized = normalizePath(raw);
  return normalized.toLowerCase().endsWith('.md') ? normalized : `${normalized}.md`;
}

export function getUniqueMarkdownPath(app: App, folderPath: string, basename: string): string {
  const prefix = folderPath ? `${folderPath}/` : '';
  let counter = 1;
  let candidate = normalizePath(`${prefix}${basename}.md`);
  while (app.vault.getAbstractFileByPath(candidate)) {
    counter += 1;
    candidate = normalizePath(`${prefix}${basename} ${counter}.md`);
  }
  return candidate;
}

async function ensureFolderPath(app: App, path: string): Promise<void> {
  const clean = normalizePath(path).trim();
  if (!clean) return;
  const segments = clean.split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

export async function applyNotebookNavigatorRulesToFile(plugin: TPSGlobalContextMenuPlugin, file: TFile): Promise<void> {
  try {
    await plugin.notebookNavigatorRuleService.applyRulesToFile(file, {
      reason: 'gcm-subitem-create',
      force: true,
      bypassCreationGrace: true,
    });
  } catch (error) {
    logger.warn('[TPS GCM] Failed applying Notebook Navigator rules after subitem create:', file.path, error);
  }
}

async function mergeParentTagsIntoSubitem(
  plugin: TPSGlobalContextMenuPlugin,
  file: TFile,
  parentTags: string[],
): Promise<void> {
  if (parentTags.length === 0) return;

  await new Promise((resolve) => setTimeout(resolve, 100));

  try {
    const cache = plugin.app.metadataCache.getFileCache(file);
    const currentFrontmatter = (cache?.frontmatter || {}) as Record<string, any>;
    const currentTags = parseTagInput([currentFrontmatter.tags, currentFrontmatter.tag]);
    const mergedTags = mergeNormalizedTags(parentTags, currentTags);
    const currentTagsStr = JSON.stringify([...currentTags].sort());
    const mergedTagsStr = JSON.stringify([...mergedTags].sort());

    if (currentTagsStr !== mergedTagsStr) {
      await plugin.frontmatterMutationService.process(file, (fm) => {
        setFrontmatterValueCaseInsensitive(fm as Record<string, any>, 'tags', mergedTags);
      });
    }
  } catch (error) {
    logger.warn('[TPS GCM] Failed merging parent tags into subitem:', file.path, error);
  }
}

function resolveNewSubitemIconDefaults(app: App, parentFile: TFile, folderPath: string): { icon: string; iconColor: string } {
  const fromParent = resolveIconDefaultsFromFile(app, parentFile);
  const fromFolder = resolveIconDefaultsFromFolder(app, folderPath);
  return {
    icon: fromParent.icon || fromFolder.icon,
    iconColor: fromParent.iconColor || fromFolder.iconColor,
  };
}

function resolveIconDefaultsFromFile(app: App, file: TFile): { icon: string; iconColor: string } {
  const cache = app.metadataCache.getFileCache(file);
  const fm = (cache?.frontmatter || {}) as Record<string, any>;
  const icon = readFrontmatterStringCaseInsensitive(fm, ['icon']);
  const iconColor = readFrontmatterStringCaseInsensitive(fm, ['iconColor', 'color', 'accentColor', 'accent']);
  return { icon, iconColor };
}

function resolveIconDefaultsFromFolder(app: App, folderPath: string): { icon: string; iconColor: string } {
  const normalizedFolder = normalizePath((folderPath || '').trim());
  const folderFiles = app.vault.getMarkdownFiles().filter((file) => (file.parent?.path || '') === normalizedFolder);
  const iconCounts = new Map<string, number>();
  const colorCounts = new Map<string, number>();

  for (const file of folderFiles) {
    const { icon, iconColor } = resolveIconDefaultsFromFile(app, file);
    if (icon) iconCounts.set(icon, (iconCounts.get(icon) || 0) + 1);
    if (iconColor) colorCounts.set(iconColor, (colorCounts.get(iconColor) || 0) + 1);
  }

  const pickMostCommon = (counts: Map<string, number>): string => {
    let best = '';
    let bestCount = -1;
    for (const [value, count] of counts.entries()) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  };

  return {
    icon: pickMostCommon(iconCounts),
    iconColor: pickMostCommon(colorCounts),
  };
}

function readFrontmatterStringCaseInsensitive(frontmatter: Record<string, any> | null | undefined, keys: string[]): string {
  if (!frontmatter || typeof frontmatter !== 'object') return '';
  for (const key of keys) {
    const value = getFrontmatterValueCaseInsensitive(frontmatter, key);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return '';
}

function getFrontmatterValueCaseInsensitive(frontmatter: Record<string, any> | null | undefined, key: string): any {
  if (!frontmatter || !key) return undefined;
  if (key in frontmatter) return frontmatter[key];
  const lowerKey = key.toLowerCase();
  const match = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === lowerKey);
  return match ? frontmatter[match] : undefined;
}

function setFrontmatterValueCaseInsensitive(frontmatter: Record<string, any>, key: string, value: any): void {
  if (!frontmatter || typeof frontmatter !== 'object') return;
  if (key in frontmatter) {
    frontmatter[key] = value;
    return;
  }
  const lowerKey = key.toLowerCase();
  const existingKey = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === lowerKey);
  frontmatter[existingKey ?? key] = value;
}

function filterIgnoredSubitemTags(plugin: TPSGlobalContextMenuPlugin, tags: string[]): string[] {
  const ignored = new Set(
    (plugin.settings.ignoredSubitemTags || [])
      .map((tag) => String(tag || '').trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean),
  );
  if (ignored.size === 0) return tags;
  return tags.filter((tag) => !ignored.has(String(tag || '').trim().replace(/^#/, '').toLowerCase()));
}

function collectInheritedParentFrontmatterLines(
  frontmatter: Record<string, any> | null | undefined,
  existingKeys: Iterable<string> = [],
): string[] {
  if (!frontmatter || typeof frontmatter !== 'object') return [];
  const inheritedKeys = ['scheduled', 'due', 'date', 'start', 'end', 'allDay'];
  const lines: string[] = [];
  const seen = new Set(
    Array.from(existingKeys)
      .map((key) => String(key || '').trim().toLowerCase())
      .filter(Boolean),
  );
  for (const key of inheritedKeys) {
    const normalizedKey = key.toLowerCase();
    if (seen.has(normalizedKey)) continue;
    const value = getFrontmatterValueCaseInsensitive(frontmatter, key);
    const serialized = serializeSimpleYamlProperty(key, value);
    if (!serialized) continue;
    lines.push(`${key}: ${serialized}`);
    seen.add(normalizedKey);
  }
  return lines;
}

function dedupeFrontmatterLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s|$)/);
    if (!match) {
      output.push(line);
      continue;
    }
    const key = match[1].trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(line);
  }
  return output;
}

function serializeSimpleYamlProperty(key: string, value: any): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (isDateLikeFrontmatterKey(key)) return normalizeObsidianDateTimeValue(trimmed);
    return `"${trimmed.replace(/"/g, '\\"')}"`;
  }
  return '';
}

function isDateLikeFrontmatterKey(key: string): boolean {
  return ['scheduled', 'due', 'date', 'start', 'end', 'remindersnooze'].includes(
    String(key || '').trim().toLowerCase().replace(/[\s_-]+/g, ''),
  );
}

function normalizeObsidianDateTimeValue(value: string): string {
  const trimmed = value.trim();
  const dateTime = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (dateTime) {
    return `${dateTime[1]} ${dateTime[2].padStart(2, '0')}:${dateTime[3]}:${dateTime[4] ?? '00'}`;
  }
  return trimmed;
}
