import { MarkdownView, Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { TextInputModal } from '../modals/text-input-modal';
import { isStrictSourceMode } from './leaf-resolver';
import * as logger from '../logger';
import { getPlainDisplayTitle } from '../utils/display-title';

export class NoteTitleRenderService {
  private readonly linkTitleCache = new Map<string, string>();
  private readonly lastFilenameSyncKey = new Map<string, string>();
  private lastInlineTitlePromptAt = 0;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  getDisplayTitle(file: TFile): string {
    const cached = this.linkTitleCache.get(file.path);
    if (cached) return cached;
    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    const titleKey = Object.keys(frontmatter || {}).find((key) => key.trim().toLowerCase() === 'title');
    const rawTitle = titleKey ? frontmatter?.[titleKey] : undefined;
    const display = getPlainDisplayTitle(rawTitle, file.basename);
    this.linkTitleCache.set(file.path, display);
    return display;
  }

  clearTitleCache(filePath?: string): void {
    if (filePath) {
      this.linkTitleCache.delete(filePath);
      return;
    }
    this.linkTitleCache.clear();
  }

  processRenderedNoteLinks(root: HTMLElement, sourcePath?: string): void {
    const links = Array.from(root.querySelectorAll<HTMLElement>(
      [
        'a.internal-link',
        '.internal-link',
        'a[href^="app://obsidian.md/"]',
        'a[data-href]',
        'a[data-linkpath]',
      ].join(', '),
    ));
    for (const link of links) {
      this.replaceLinkTextWithTitle(link, sourcePath || '');
    }
  }

  refreshInlineTitles(): void {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as MarkdownView;
      if (!(view?.file instanceof TFile) || !(view?.contentEl instanceof HTMLElement)) continue;
      this.refreshInlineTitleForView(view);
      for (const renderedRoot of Array.from(view.contentEl.querySelectorAll<HTMLElement>(
        '.markdown-preview-view, .markdown-reading-view, .markdown-rendered, .markdown-preview-section',
      ))) {
        this.processRenderedNoteLinks(renderedRoot, view.file.path);
      }
    }
  }

  refreshInlineTitle(view: MarkdownView): void {
    this.refreshInlineTitleForView(view);
  }

  scheduleInlineTitleRefresh(view: MarkdownView, delays: number[] = [0, 120, 400]): void {
    for (const delay of delays) {
      window.setTimeout(() => this.refreshInlineTitleForView(view), delay);
    }
  }

  handleInlineTitleActivation(event: MouseEvent | PointerEvent): boolean {
    if (event instanceof MouseEvent && event.button !== 0) return false;
    if (event instanceof PointerEvent && event.button !== 0) return false;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('.tps-gcm-note-title-icon')) return false;
    const titleEl = target?.closest<HTMLElement>('.inline-title');
    if (!titleEl) return false;
    if (!this.isMarkdownInlineTitle(titleEl)) return false;
    const file = this.resolveFileForInlineTitle(titleEl);
    if (!(file instanceof TFile)) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const now = Date.now();
    if (now - this.lastInlineTitlePromptAt < 600) return true;
    this.lastInlineTitlePromptAt = now;
    void this.promptRenameTitle(file);
    return true;
  }

  handleInlineTitleKeydown(event: KeyboardEvent): boolean {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
    const titleEl = this.resolveInlineTitleFromKeyboardEvent(event);
    if (!titleEl) return false;
    if (!this.isMarkdownInlineTitle(titleEl)) return false;
    if (!titleEl.hasClass('tps-gcm-inline-title-frontmatter')) return false;
    const file = this.resolveFileForInlineTitle(titleEl);
    if (!(file instanceof TFile)) return false;
    const visibleTitle = String(titleEl.textContent || '').replace(/\s+/g, ' ').trim();
    if (!this.isGeneratedUntitledTitle(file, visibleTitle)) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void this.clearGeneratedTitle(file);
    return true;
  }

  handleInlineTitleKeyup(event: KeyboardEvent): boolean {
    if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
    const file = this.plugin.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return false;
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file?.path !== file.path) return false;
    const titleEl = this.resolveInlineTitleElement(view);
    if (!titleEl || !this.isMarkdownInlineTitle(titleEl)) return false;
    const visibleTitle = String(titleEl.textContent || '').replace(/\s+/g, ' ').trim();
    if (visibleTitle) return false;
    const frontmatterTitle = this.getFrontmatterTitle(file);
    if (!this.isGeneratedUntitledTitle(file, frontmatterTitle)) return false;
    void this.clearGeneratedTitle(file);
    return true;
  }

  async promptRenameTitle(file: TFile): Promise<void> {
    if (!(file instanceof TFile) || file.extension !== 'md') {
      new Notice('Only markdown note titles can be renamed.');
      return;
    }

    const currentTitle = this.getDisplayTitle(file);
    logger.flow('NoteTitle', 'rename:prompt', {
      path: file.path,
      displayTitle: currentTitle,
      autoRename: this.plugin.settings.enableAutoRename === true,
    });
    new TextInputModal(this.plugin.app, 'Title', currentTitle, async (value) => {
      const nextTitle = String(value ?? '').replace(/\s+/g, ' ').trim();
      if (!nextTitle) {
        new Notice('Title cannot be empty.');
        return;
      }

      try {
        const liveFile = this.plugin.app.vault.getFileByPath(file.path);
        if (!(liveFile instanceof TFile)) return;
        await this.plugin.bulkEditService.updateFrontmatter([liveFile], { title: nextTitle });
        this.clearTitleCache(liveFile.path);
        if (this.plugin.settings.enableAutoRename) {
          await this.plugin.fileNamingService.updateFilenameIfNeeded(liveFile, {
            bypassCreationGrace: true,
            bypassProcessingLock: true,
            titleOverride: nextTitle,
          });
        }
        this.plugin.eventService.emitFilesUpdated([liveFile.path]);
        this.plugin.overlayRenderingService.scheduleFileRefresh(liveFile, 'title-rename', { force: true, delayMs: 0 });
        logger.flow('NoteTitle', 'rename:done', {
          sourcePath: file.path,
          resultingPath: liveFile.path,
          displayTitle: nextTitle,
          autoRename: this.plugin.settings.enableAutoRename === true,
        });
      } catch (error) {
        logger.flowError('NoteTitle', 'rename:failed', error, { path: file.path });
        logger.error('[TPS GCM] Failed renaming note title:', error);
        new Notice('Title rename failed.');
      }
    }).open();
  }

  private replaceLinkTextWithTitle(link: HTMLElement, sourcePath: string): void {
    if (link.closest('.tps-global-context-menu, .menu, .modal')) return;
    const targetFile = this.resolveLinkTarget(link, sourcePath);
    if (!(targetFile instanceof TFile)) return;

    const displayTitle = this.getDisplayTitle(targetFile);
    if (!displayTitle || displayTitle === link.textContent) return;
    if (!this.isUnaliasedFilenameRender(link, targetFile)) return;

    link.dataset.tpsGcmRenderedTitle = displayTitle;
    link.dataset.tpsGcmOriginalText = link.dataset.tpsGcmOriginalText || String(link.textContent || '');
    link.textContent = displayTitle;
    link.title = targetFile.path;
  }

  private isUnaliasedFilenameRender(link: HTMLElement, file: TFile): boolean {
    const visible = String(link.textContent || '').replace(/\s+/g, ' ').trim();
    if (!visible) return false;
    if (visible === file.basename || visible === file.name || visible === file.path) return true;
    const target = this.getRawLinkTarget(link).replace(/\.md$/i, '').replace(/^\/+/, '').trim();
    const targetBasename = target.split('/').pop() || target;
    return visible === target || visible === targetBasename;
  }

  private resolveLinkTarget(link: HTMLElement, sourcePath: string): TFile | null {
    const rawTarget = this.getRawLinkTarget(link);
    if (!rawTarget) return null;
    const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(rawTarget, sourcePath);
    if (resolved instanceof TFile) return resolved;
    const direct = this.plugin.app.vault.getFileByPath(rawTarget);
    return direct instanceof TFile ? direct : null;
  }

  private getRawLinkTarget(link: HTMLElement): string {
    const raw = String(
      link.dataset.href
      || link.dataset.linkpath
      || link.getAttribute('data-href')
      || link.getAttribute('data-linkpath')
      || link.getAttribute('href')
      || '',
    );
    return this.normalizeRawLinkTarget(raw)
      .split('|')[0]
      .split('#')[0]
      .trim();
  }

  private normalizeRawLinkTarget(raw: string): string {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (!/^app:\/\/obsidian\.md\//i.test(value)) return value;
    try {
      const url = new URL(value);
      return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch {
      return decodeURIComponent(value.replace(/^app:\/\/obsidian\.md\//i, '').replace(/^\/+/, ''));
    }
  }

  private refreshInlineTitleForView(view: MarkdownView): void {
    const file = view.file;
    if (!(file instanceof TFile)) return;
    const titleEl = this.resolveInlineTitleElement(view);
    if (!titleEl) return;
    if (document.activeElement instanceof HTMLElement && titleEl.contains(document.activeElement)) return;
    if (isStrictSourceMode(view)) {
      this.restoreFilenameInlineTitle(titleEl, file);
      return;
    }
    const displayTitle = this.getDisplayTitle(file);
    if (!displayTitle) return;
    this.reconcileFilenameForRenderedTitle(file, displayTitle);
    if (titleEl.textContent === displayTitle) return;
    titleEl.dataset.tpsGcmOriginalInlineTitle = titleEl.dataset.tpsGcmOriginalInlineTitle || String(titleEl.textContent || '');
    titleEl.dataset.tpsGcmRenderedTitle = displayTitle;
    this.setInlineTitleText(titleEl, displayTitle);
    titleEl.title = `${file.path} (click to edit title)`;
    titleEl.addClass('tps-gcm-inline-title-frontmatter');
  }

  private resolveInlineTitleElement(view: MarkdownView): HTMLElement | null {
    const root = view.contentEl;
    if (!root) return null;

    if (isStrictSourceMode(view)) {
      return (
        root.querySelector<HTMLElement>('.markdown-source-view .inline-title') ||
        root.querySelector<HTMLElement>('.markdown-source-view .cm-line.inline-title') ||
        root.querySelector<HTMLElement>('.markdown-source-view [aria-label*="click to edit title"]') ||
        root.querySelector<HTMLElement>('[aria-label*=".md"][aria-label*="click to edit title"]') ||
        root.querySelector<HTMLElement>('.inline-title') ||
        null
      );
    }

    return root.querySelector<HTMLElement>('.inline-title');
  }

  private restoreFilenameInlineTitle(titleEl: HTMLElement, file: TFile): void {
    if (titleEl.textContent !== file.basename || titleEl.dataset.tpsGcmRenderedTitle) {
      this.setInlineTitleText(titleEl, file.basename);
    }
    delete titleEl.dataset.tpsGcmRenderedTitle;
    delete titleEl.dataset.tpsGcmOriginalInlineTitle;
    titleEl.title = file.path;
    titleEl.setAttribute('aria-label', `${file.path} (click to edit title)`);
    titleEl.removeClass('tps-gcm-inline-title-frontmatter');
  }

  private setInlineTitleText(titleEl: HTMLElement, displayTitle: string): void {
    const iconEl = titleEl.querySelector<HTMLElement>(':scope > .tps-gcm-note-title-icon');
    for (const child of Array.from(titleEl.childNodes)) {
      if (iconEl && child === iconEl) continue;
      child.remove();
    }
    titleEl.appendChild(document.createTextNode(displayTitle));
  }

  private resolveFileForInlineTitle(titleEl: HTMLElement): TFile | null {
    const leafContent = titleEl.closest<HTMLElement>('.workspace-leaf-content[data-type="markdown"]');
    const leaf = this.plugin.app.workspace.getLeavesOfType('markdown').find((candidate) =>
      !!leafContent
      && (candidate.view as MarkdownView | undefined)?.contentEl instanceof HTMLElement
      && leafContent.contains((candidate.view as MarkdownView).contentEl),
    );
    const file = (leaf?.view as MarkdownView | undefined)?.file ?? null;
    return file instanceof TFile ? file : this.plugin.app.workspace.getActiveFile();
  }

  private isMarkdownInlineTitle(titleEl: HTMLElement): boolean {
    return !!titleEl.closest('.workspace-leaf-content[data-type="markdown"]');
  }

  private resolveInlineTitleFromKeyboardEvent(event: KeyboardEvent): HTMLElement | null {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const direct = target?.closest<HTMLElement>('.inline-title');
    if (direct) return direct;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeTitle = active?.closest<HTMLElement>('.inline-title');
    if (activeTitle) return activeTitle;
    const selection = document.getSelection();
    const anchor = selection?.anchorNode;
    const focus = selection?.focusNode;
    for (const node of [anchor, focus]) {
      const element = node instanceof HTMLElement ? node : node?.parentElement ?? null;
      const selectedTitle = element?.closest<HTMLElement>('.inline-title');
      if (selectedTitle) return selectedTitle;
    }
    return null;
  }

  private isGeneratedUntitledTitle(file: TFile, title: string): boolean {
    const basename = String(file.basename || '').replace(/\s+/g, ' ').trim();
    return /^Untitled(?: \d+)?$/i.test(basename) && title === basename;
  }

  private getFrontmatterTitle(file: TFile): string {
    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    const titleKey = Object.keys(frontmatter || {}).find((key) => key.trim().toLowerCase() === 'title');
    const rawTitle = titleKey ? frontmatter?.[titleKey] : undefined;
    return typeof rawTitle === 'string' ? rawTitle.replace(/\s+/g, ' ').trim() : '';
  }

  private async clearGeneratedTitle(file: TFile): Promise<void> {
    try {
      const liveFile = this.plugin.app.vault.getFileByPath(file.path);
      if (!(liveFile instanceof TFile)) return;
      await this.plugin.frontmatterMutationService.process(liveFile, (frontmatter) => {
        for (const key of Object.keys(frontmatter)) {
          if (key.trim().toLowerCase() === 'title') {
            delete frontmatter[key];
          }
        }
      });
      this.clearTitleCache(liveFile.path);
      this.plugin.eventService.emitFilesUpdated([liveFile.path]);
      this.plugin.overlayRenderingService.scheduleFileRefresh(liveFile, 'generated-title-clear', { force: true, delayMs: 0 });
    } catch (error) {
      logger.error('[TPS GCM] Failed clearing generated note title:', error);
    }
  }

  private reconcileFilenameForRenderedTitle(file: TFile, displayTitle: string): void {
    if (!this.plugin.settings.enableAutoRename) return;
    const title = String(displayTitle || '').replace(/\s+/g, ' ').trim();
    if (!title) return;
    const key = `${file.path}\n${title}`;
    if (this.lastFilenameSyncKey.get(file.path) === key) return;
    this.lastFilenameSyncKey.set(file.path, key);
    window.setTimeout(() => {
      const liveFile = this.plugin.app.vault.getFileByPath(file.path);
      if (!(liveFile instanceof TFile)) return;
      void this.plugin.fileNamingService.updateFilenameIfNeeded(liveFile, {
        bypassCreationGrace: true,
        bypassProcessingLock: true,
        titleOverride: title,
      });
    }, 0);
  }
}
