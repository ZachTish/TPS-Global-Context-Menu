import { TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import type { BodySubitemLink } from './subitem-types';

export class SubitemReferenceIndexService {
  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  async getReferencesForChild(childFile: TFile): Promise<BodySubitemLink[]> {
    if (this.plugin.parentLinkResolutionService.isIgnoredFile(childFile)) return [];
    const links: BodySubitemLink[] = [];
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (this.plugin.parentLinkResolutionService.isIgnoredFile(file)) continue;
      const parsed = await this.plugin.bodySubitemLinkService.scanFile(file);
      links.push(...parsed.filter((entry) => entry.childPath === childFile.path));
    }
    return links;
  }

  /** True when a persisted body reference exists only behind an ignored parent. */
  async hasIgnoredReferenceForChild(childFile: TFile): Promise<boolean> {
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (!this.plugin.parentLinkResolutionService.isIgnoredFile(file)) continue;
      const parsed = await this.plugin.bodySubitemLinkService.scanFile(file);
      if (parsed.some((entry) => entry.childPath === childFile.path)) return true;
    }
    return false;
  }
}
