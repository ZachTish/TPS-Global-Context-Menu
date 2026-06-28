import { TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { findKeyCaseInsensitive } from '../core';

export interface LegacyCalendarIdentityMigrationItem {
  path: string;
  tpsIdAction: 'keep' | 'create';
  externalId: string;
  legacyFields: string[];
}

export interface LegacyCalendarIdentityMigrationDryRun {
  scanned: number;
  candidates: LegacyCalendarIdentityMigrationItem[];
}

export class IdentityMigrationService {
  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  async dryRunLegacyCalendarIdentityMigration(): Promise<LegacyCalendarIdentityMigrationDryRun> {
    const candidates: LegacyCalendarIdentityMigrationItem[] = [];
    let scanned = 0;

    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (!(file instanceof TFile) || file.extension !== 'md') continue;
      if (this.shouldSkipFile(file)) continue;
      scanned += 1;

      const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
      if (!frontmatter) continue;

      const legacy = this.plugin.identityService.readLegacyCalendarIdentity(frontmatter);
      if (!legacy?.externalId) continue;

      candidates.push({
        path: file.path,
        tpsIdAction: this.plugin.identityService.getInternalId(frontmatter) ? 'keep' : 'create',
        externalId: legacy.externalId,
        legacyFields: this.getPresentLegacyFields(frontmatter),
      });
    }

    return { scanned, candidates };
  }

  private getPresentLegacyFields(frontmatter: Record<string, unknown>): string[] {
    return ['externalEventId', 'tpsCalendarUid', 'tpsCalendarSourceUrl']
      .filter((key) => Boolean(findKeyCaseInsensitive(frontmatter, key)));
  }

  private shouldSkipFile(file: TFile): boolean {
    const path = file.path.toLowerCase();
    return path.startsWith('.trash/') || path.startsWith('.obsidian/') || path.includes('/node_modules/');
  }
}
