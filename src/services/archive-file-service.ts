import { App, Notice, TFile, TFolder, normalizePath } from 'obsidian';
import * as logger from '../logger';
import {
  mergeNormalizedTags,
  normalizeTagList,
  normalizeTagValue,
} from '../utils/tag-utils';

export interface ArchiveFileServiceHost {
  app: App;
  frontmatterMutationService: {
    process(
      file: TFile,
      mutator: (frontmatter: Record<string, unknown>) => void | Promise<void>,
    ): Promise<boolean>;
  };
  settings: {
    archiveTag?: string;
    activityLogPropertyKey?: string;
  };
  getArchiveFolderPath(): string;
  runQueuedMove(files: TFile[], performMove: () => Promise<void>): Promise<boolean>;
}

export interface ArchiveFilesResult {
  archiveFolder: string;
  requested: number;
  moved: number;
  tagged: number;
  skipped: number;
  failed: number;
  metadataFailures: number;
}

export interface UnarchiveFilesResult {
  archiveFolder: string;
  requested: number;
  moved: number;
  skipped: number;
  failed: number;
  metadataFailures: number;
}

function normalizeFolderPath(path: string): string {
  return normalizePath(String(path || '').trim()).replace(/^\/+|\/+$/g, '');
}

export function isPathInArchiveFolder(path: string, archiveFolder: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedFolder = normalizeFolderPath(archiveFolder);
  if (!normalizedFolder) return false;
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

export function getArchiveRelativeOriginalFolder(filePath: string, archiveFolder: string): string {
  const normalizedPath = normalizePath(filePath);
  const normalizedFolder = normalizeFolderPath(archiveFolder);
  if (!normalizedFolder || !normalizedPath.startsWith(`${normalizedFolder}/`)) return '';

  const relativePath = normalizedPath.slice(normalizedFolder.length + 1);
  const separator = relativePath.lastIndexOf('/');
  return separator >= 0 ? relativePath.slice(0, separator) : '';
}

export class ArchiveFileService {
  constructor(private readonly plugin: ArchiveFileServiceHost) {}

  async archiveFiles(files: TFile[], trigger = 'unknown'): Promise<ArchiveFilesResult> {
    const archiveFolder = normalizeFolderPath(this.plugin.getArchiveFolderPath());
    const uniqueFiles = this.getUniqueFiles(files);
    const result: ArchiveFilesResult = {
      archiveFolder,
      requested: uniqueFiles.length,
      moved: 0,
      tagged: 0,
      skipped: 0,
      failed: 0,
      metadataFailures: 0,
    };

    if (!archiveFolder) {
      result.failed = uniqueFiles.length;
      logger.warn('[TPS GCM] Archive menu action skipped: no archive folder', {
        trigger,
        requested: result.requested,
      });
      new Notice('Archive folder setting is not configured.');
      return result;
    }

    if (uniqueFiles.length === 0) {
      new Notice('No files to archive.');
      return result;
    }

    try {
      await this.ensureFolderPath(archiveFolder);
    } catch (error) {
      result.failed = uniqueFiles.length;
      logger.error('[TPS GCM] Failed preparing archive folder', {
        trigger,
        archiveFolder,
        error,
      });
      new Notice('Could not prepare the archive folder.');
      return result;
    }

    const archiveTag = normalizeTagValue(this.plugin.settings.archiveTag || '');
    const queued = await this.plugin.runQueuedMove(uniqueFiles, async () => {
      for (const originalFile of uniqueFiles) {
        const current = this.plugin.app.vault.getAbstractFileByPath(originalFile.path);
        const liveFile = current instanceof TFile ? current : null;
        if (!liveFile) {
          result.failed += 1;
          logger.warn('[TPS GCM] Archive file no longer exists', {
            trigger,
            path: originalFile.path,
          });
          continue;
        }

        if (isPathInArchiveFolder(liveFile.path, archiveFolder)) {
          result.skipped += 1;
          continue;
        }

        const originalFolder = liveFile.parent?.path === '/' ? '' : liveFile.parent?.path ?? '';
        if (liveFile.extension?.toLowerCase() === 'md' && archiveTag) {
          try {
            await this.plugin.frontmatterMutationService.process(liveFile, (frontmatter: Record<string, unknown>) => {
              frontmatter.tags = mergeNormalizedTags(frontmatter.tags, archiveTag);
              frontmatter.archiveOriginalFolder = originalFolder;
            });
            result.tagged += 1;
          } catch (error) {
            result.metadataFailures += 1;
            logger.warn('[TPS GCM] Archive metadata write failed; continuing with immediate move', {
              trigger,
              path: liveFile.path,
              error,
            });
          }
        }

        try {
          const targetPath = this.getUniqueArchiveTargetPath(liveFile, archiveFolder);
          const targetFolder = targetPath.includes('/')
            ? targetPath.slice(0, targetPath.lastIndexOf('/'))
            : '';
          if (targetFolder) {
            await this.ensureFolderPath(targetFolder);
          }
          await this.plugin.app.fileManager.renameFile(liveFile, targetPath);
          result.moved += 1;
        } catch (error) {
          result.failed += 1;
          logger.error('[TPS GCM] Failed moving file into archive', {
            trigger,
            path: liveFile.path,
            archiveFolder,
            error,
          });
        }
      }
    });

    if (!queued) {
      result.failed = Math.max(
        result.failed,
        result.requested - result.moved - result.skipped,
      );
    }

    logger.log('[TPS GCM] Archive menu action complete', {
      trigger,
      archiveFolder,
      requested: result.requested,
      moved: result.moved,
      tagged: result.tagged,
      skipped: result.skipped,
      failed: result.failed,
      metadataFailures: result.metadataFailures,
    });
    this.showResultNotice(result);
    return result;
  }

  async unarchiveFiles(files: TFile[], trigger = 'native-context-menu'): Promise<UnarchiveFilesResult> {
    const archiveFolder = normalizeFolderPath(this.plugin.getArchiveFolderPath());
    const uniqueFiles = this.getUniqueFiles(files);
    const result: UnarchiveFilesResult = {
      archiveFolder,
      requested: uniqueFiles.length,
      moved: 0,
      skipped: 0,
      failed: 0,
      metadataFailures: 0,
    };

    if (!archiveFolder) {
      result.failed = uniqueFiles.length;
      logger.warn('[TPS GCM] Unarchive menu action skipped: no archive folder', {
        trigger,
        requested: result.requested,
      });
      new Notice('Archive folder setting is not configured.');
      return result;
    }

    if (uniqueFiles.length === 0) {
      new Notice('No files to unarchive.');
      return result;
    }

    const archiveTag = normalizeTagValue(this.plugin.settings.archiveTag || '');
    const queued = await this.plugin.runQueuedMove(uniqueFiles, async () => {
      for (const originalFile of uniqueFiles) {
        const current = this.plugin.app.vault.getAbstractFileByPath(originalFile.path);
        const liveFile = current instanceof TFile ? current : null;
        if (!liveFile) {
          result.failed += 1;
          logger.warn('[TPS GCM] Unarchive file no longer exists', {
            trigger,
            path: originalFile.path,
          });
          continue;
        }

        if (!isPathInArchiveFolder(liveFile.path, archiveFolder)) {
          result.skipped += 1;
          continue;
        }

        const archivedPath = liveFile.path;
        const originalFolder = this.getOriginalFolder(liveFile, archiveFolder);
        const targetFolder = await this.getRestoreFolder(originalFolder, archiveFolder, trigger);
        const targetPath = this.getUniqueRestoreTargetPath(liveFile, targetFolder);

        try {
          await this.plugin.app.fileManager.renameFile(liveFile, targetPath);
        } catch (error) {
          result.failed += 1;
          logger.error('[TPS GCM] Failed moving file out of archive', {
            trigger,
            path: liveFile.path,
            targetPath,
            error,
          });
          continue;
        }

        if (liveFile.extension?.toLowerCase() === 'md') {
          const cleanupRequiredFromCache = this.hasArchiveCleanupMetadata(liveFile, archiveTag);
          try {
            let cleanupRequiredByMutation = false;
            const cleanupResult = await (
              this.plugin.frontmatterMutationService.process(liveFile, (frontmatter: Record<string, unknown>) => {
                cleanupRequiredByMutation = this.hasArchiveCleanupMetadataInRecord(frontmatter, archiveTag);
                this.deleteValueCaseInsensitive(frontmatter, 'archiveOriginalFolder');
                if (archiveTag) {
                  frontmatter.tags = normalizeTagList(frontmatter.tags)
                    .filter((tag) => normalizeTagValue(tag) !== archiveTag);
                }
              }) as Promise<unknown>
            );
            if (cleanupResult === false && (cleanupRequiredFromCache || cleanupRequiredByMutation)) {
              throw new Error('Archive metadata cleanup was refused.');
            }
          } catch (error) {
            result.metadataFailures += 1;
            const rolledBack = await this.rollbackFailedUnarchive(liveFile, archivedPath, trigger);
            result.failed += 1;
            if (!rolledBack) {
              result.moved += 1;
            }
            logger.warn('[TPS GCM] Unarchive metadata cleanup failed; move rollback attempted', {
              trigger,
              path: liveFile.path,
              archivedPath,
              rolledBack,
              error,
            });
            continue;
          }
        }
        result.moved += 1;
      }
    });

    if (!queued) {
      result.failed = Math.max(
        result.failed,
        result.requested - result.moved - result.skipped,
      );
    }

    logger.log('[TPS GCM] Unarchive menu action complete', {
      trigger,
      archiveFolder,
      requested: result.requested,
      moved: result.moved,
      skipped: result.skipped,
      failed: result.failed,
      metadataFailures: result.metadataFailures,
    });
    this.showUnarchiveResultNotice(result);
    return result;
  }

  private getUniqueFiles(files: TFile[]): TFile[] {
    const unique = new Map<string, TFile>();
    for (const file of files || []) {
      if (!(file instanceof TFile)) continue;
      const path = normalizePath(file.path);
      if (!unique.has(path)) unique.set(path, file);
    }
    return Array.from(unique.values());
  }

  private async ensureFolderPath(folderPath: string): Promise<void> {
    let current = '';
    for (const part of normalizeFolderPath(folderPath).split('/').filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      const existing = this.plugin.app.vault.getAbstractFileByPath(current);
      if (!existing) {
        await this.plugin.app.vault.createFolder(current);
      } else if (!(existing instanceof TFolder)) {
        throw new Error(`Archive folder path conflicts with an existing file: ${current}`);
      }
    }
  }

  private getUniqueArchiveTargetPath(file: TFile, archiveFolder: string): string {
    const sourceFolder = file.parent?.path === '/' ? '' : file.parent?.path ?? '';
    const targetFolder = sourceFolder && !isPathInArchiveFolder(sourceFolder, archiveFolder)
      ? normalizePath(`${archiveFolder}/${sourceFolder}`)
      : archiveFolder;
    const extension = file.extension ? `.${file.extension}` : '';
    const baseTarget = normalizePath(`${targetFolder}/${file.basename}${extension}`);
    if (!this.plugin.app.vault.getAbstractFileByPath(baseTarget)) {
      return baseTarget;
    }

    let counter = 1;
    let targetPath = '';
    do {
      targetPath = normalizePath(`${targetFolder}/${file.basename} ${counter}${extension}`);
      counter += 1;
    } while (this.plugin.app.vault.getAbstractFileByPath(targetPath));
    return targetPath;
  }

  private getOriginalFolder(file: TFile, archiveFolder: string): string {
    if (file.extension?.toLowerCase() === 'md') {
      const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter && typeof frontmatter === 'object') {
        const originalFolder = this.getValueCaseInsensitive(frontmatter, 'archiveOriginalFolder');
        if (typeof originalFolder === 'string' && originalFolder.trim()) {
          return normalizeFolderPath(originalFolder);
        }

        const activityKey = String(this.plugin.settings.activityLogPropertyKey || 'activity').trim() || 'activity';
        const activity = this.getValueCaseInsensitive(frontmatter, activityKey);
        if (Array.isArray(activity)) {
          for (let index = activity.length - 1; index >= 0; index -= 1) {
            const entry = activity[index];
            if (entry?.type === 'archive' && typeof entry.folder === 'string') {
              return normalizeFolderPath(entry.folder);
            }
          }
        }
      }
    }
    return getArchiveRelativeOriginalFolder(file.path, archiveFolder);
  }

  private async getRestoreFolder(
    originalFolder: string,
    archiveFolder: string,
    trigger: string,
  ): Promise<string> {
    const normalizedFolder = normalizeFolderPath(originalFolder);
    if (!normalizedFolder) return '';
    if (isPathInArchiveFolder(normalizedFolder, archiveFolder)) {
      logger.warn('[TPS GCM] Refused restore folder inside the active archive root', {
        trigger,
        originalFolder: normalizedFolder,
        archiveFolder,
      });
      return '';
    }

    const existing = this.plugin.app.vault.getAbstractFileByPath(normalizedFolder);
    if (existing instanceof TFolder) return normalizedFolder;
    if (!existing) {
      try {
        await this.ensureFolderPath(normalizedFolder);
        return normalizedFolder;
      } catch (error) {
        logger.warn('[TPS GCM] Could not recreate the original archive folder; restoring to vault root', {
          trigger,
          originalFolder: normalizedFolder,
          error,
        });
        return '';
      }
    }

    logger.warn('[TPS GCM] Original archive folder conflicts with a file; restoring to vault root', {
      trigger,
      originalFolder: normalizedFolder,
    });
    return '';
  }

  private getUniqueRestoreTargetPath(file: TFile, targetFolder: string): string {
    const baseTarget = normalizePath(targetFolder ? `${targetFolder}/${file.name}` : file.name);
    if (!this.plugin.app.vault.getAbstractFileByPath(baseTarget)) {
      return baseTarget;
    }

    const extension = file.extension ? `.${file.extension}` : '';
    let counter = 1;
    let targetPath = '';
    do {
      targetPath = normalizePath(
        targetFolder
          ? `${targetFolder}/${file.basename} ${counter}${extension}`
          : `${file.basename} ${counter}${extension}`,
      );
      counter += 1;
    } while (this.plugin.app.vault.getAbstractFileByPath(targetPath));
    return targetPath;
  }

  private hasArchiveCleanupMetadata(file: TFile, archiveTag: string): boolean {
    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    return Boolean(
      frontmatter
      && typeof frontmatter === 'object'
      && this.hasArchiveCleanupMetadataInRecord(frontmatter, archiveTag)
    );
  }

  private hasArchiveCleanupMetadataInRecord(
    frontmatter: Record<string, unknown>,
    archiveTag: string,
  ): boolean {
    const originalFolderKey = Object.keys(frontmatter)
      .find((key) => key.toLowerCase() === 'archiveoriginalfolder');
    if (originalFolderKey) return true;
    if (!archiveTag) return false;
    return normalizeTagList(frontmatter.tags)
      .some((tag) => normalizeTagValue(tag) === archiveTag);
  }

  private async rollbackFailedUnarchive(
    file: TFile,
    archivedPath: string,
    trigger: string,
  ): Promise<boolean> {
    try {
      const rollbackPath = this.getUniquePreferredTargetPath(archivedPath);
      const rollbackFolder = rollbackPath.includes('/')
        ? rollbackPath.slice(0, rollbackPath.lastIndexOf('/'))
        : '';
      if (rollbackFolder) {
        await this.ensureFolderPath(rollbackFolder);
      }
      await this.plugin.app.fileManager.renameFile(file, rollbackPath);
      logger.warn('[TPS GCM] Rolled back unarchive after metadata cleanup failure', {
        trigger,
        rollbackPath,
      });
      return true;
    } catch (rollbackError) {
      logger.error('[TPS GCM] Failed rolling unarchived file back into archive', {
        trigger,
        path: file.path,
        archivedPath,
        rollbackError,
      });
      return false;
    }
  }

  private getUniquePreferredTargetPath(preferredPath: string): string {
    const normalizedPreferred = normalizePath(preferredPath);
    if (!this.plugin.app.vault.getAbstractFileByPath(normalizedPreferred)) {
      return normalizedPreferred;
    }

    const separator = normalizedPreferred.lastIndexOf('/');
    const folder = separator >= 0 ? normalizedPreferred.slice(0, separator) : '';
    const name = separator >= 0 ? normalizedPreferred.slice(separator + 1) : normalizedPreferred;
    const extensionSeparator = name.lastIndexOf('.');
    const hasExtension = extensionSeparator > 0;
    const basename = hasExtension ? name.slice(0, extensionSeparator) : name;
    const extension = hasExtension ? name.slice(extensionSeparator) : '';

    let counter = 1;
    let candidate = '';
    do {
      const candidateName = `${basename} ${counter}${extension}`;
      candidate = normalizePath(folder ? `${folder}/${candidateName}` : candidateName);
      counter += 1;
    } while (this.plugin.app.vault.getAbstractFileByPath(candidate));
    return candidate;
  }

  private getValueCaseInsensitive(record: Record<string, unknown>, key: string): unknown {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
    const normalizedKey = key.toLowerCase();
    const existingKey = Object.keys(record)
      .find((candidate) => candidate.toLowerCase() === normalizedKey);
    return existingKey ? record[existingKey] : undefined;
  }

  private deleteValueCaseInsensitive(record: Record<string, unknown>, key: string): void {
    const normalizedKey = key.toLowerCase();
    for (const existingKey of Object.keys(record)) {
      if (existingKey.toLowerCase() === normalizedKey) {
        delete record[existingKey];
      }
    }
  }

  private showResultNotice(result: ArchiveFilesResult): void {
    if (result.moved === 0 && result.skipped > 0 && result.failed === 0) {
      new Notice(result.skipped === 1 ? 'File is already archived' : `${result.skipped} files are already archived`);
      return;
    }

    const movedLabel = result.moved === 1 ? 'Archived 1 file' : `Archived ${result.moved} files`;
    if (result.failed > 0) {
      new Notice(`${movedLabel}; ${result.failed} failed`);
      return;
    }
    new Notice(movedLabel);
  }

  private showUnarchiveResultNotice(result: UnarchiveFilesResult): void {
    const movedLabel = result.moved === 1 ? 'Unarchived 1 file' : `Unarchived ${result.moved} files`;
    if (result.failed > 0) {
      new Notice(`${movedLabel}; ${result.failed} failed`);
      return;
    }
    if (result.metadataFailures > 0) {
      new Notice(`${movedLabel}; metadata cleanup failed for ${result.metadataFailures}`);
      return;
    }
    new Notice(movedLabel);
  }
}
