import { MarkdownView, Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { isLeafVisible, isStrictSourceMode } from './leaf-resolver';
import * as logger from '../logger';
import { getPlainDisplayTitle } from '../utils/display-title';

export class NoteTitleRenderService {
  private readonly linkTitleCache = new Map<string, string>();

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  getDisplayTitle(file: TFile): string {
    const cached = this.linkTitleCache.get(file.path);
    if (cached) return cached;
    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    const titleKey = Object.keys(frontmatter || {}).find((key) => key.trim().toLowerCase() === 'title');
    const nativeTitle = this.plugin.nativeRecordService?.inspect(frontmatter)?.frontmatter.title;
    const rawTitle = nativeTitle ?? (titleKey ? frontmatter?.[titleKey] : undefined);
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

  handleMetadataChanged(file: TFile): void {
    const previousTitle = this.linkTitleCache.get(file.path);
    this.clearTitleCache(file.path);
    if (previousTitle !== undefined && previousTitle === this.getDisplayTitle(file)) return;
    // Metadata now owns the saved title. Refresh only its open views instead
    // of waiting for the periodic title/link remount pass. Body-only metadata
    // events with an unchanged cached title need no title DOM work.
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as MarkdownView;
      if (view.file?.path !== file.path) continue;
      this.refreshInlineTitleForView(view);
    }
    if (previousTitle !== undefined) {
      this.refreshRenderedNoteLinks();
    }
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
    // Measure eligibility before any title/icon writes. Retained hidden panes
    // catch up on a later visible tick; explicit render/metadata owners stay live.
    const visibleLeaves = this.plugin.app.workspace.getLeavesOfType('markdown').filter((leaf) => {
      const view = leaf.view as MarkdownView;
      return view?.file instanceof TFile && view?.contentEl instanceof HTMLElement && isLeafVisible(leaf);
    });
    for (const leaf of visibleLeaves) {
      const view = leaf.view as MarkdownView;
      this.refreshInlineTitleAndIcon(view);
      this.refreshRenderedNoteLinksForView(view);
    }
  }

  private refreshRenderedNoteLinks(): void {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as MarkdownView;
      if (!(view?.file instanceof TFile) || !view.contentEl || !(view.contentEl instanceof HTMLElement)) continue;
      this.refreshRenderedNoteLinksForView(view);
    }
  }

  private refreshRenderedNoteLinksForView(view: MarkdownView): void {
    const file = view.file;
    if (!(file instanceof TFile)) return;
    const renderedRootSelector =
      '.markdown-preview-view, .markdown-reading-view, .markdown-rendered, .markdown-preview-section';
    const renderedRoots = Array.from(
      view.contentEl.querySelectorAll<HTMLElement>(renderedRootSelector),
    );
    const renderedRootSet = new Set(renderedRoots);
    for (const renderedRoot of renderedRoots) {
      let ancestor = renderedRoot.parentElement;
      while (ancestor && !renderedRootSet.has(ancestor)) {
        ancestor = ancestor.parentElement;
      }
      if (ancestor) continue;
      this.processRenderedNoteLinks(renderedRoot, file.path);
    }
  }

  refreshInlineTitle(view: MarkdownView): void {
    this.refreshInlineTitleAndIcon(view);
  }

  scheduleInlineTitleRefresh(view: MarkdownView, delays: number[] = [0, 120, 400]): void {
    for (const delay of delays) {
      window.setTimeout(() => this.refreshInlineTitleAndIcon(view), delay);
    }
  }

  private refreshInlineTitleAndIcon(view: MarkdownView): void {
    this.refreshInlineTitleForView(view);
    this.plugin.persistentMenuManager?.refreshInlineTitleIcon(view);
  }

  handleInlineTitleActivation(event: MouseEvent | PointerEvent): boolean {
    if (event.button !== 0) return false;
    const node = event.target as Node | null;
    const target = node?.instanceOf(HTMLElement) ? node : null;
    if (target?.closest('.tps-gcm-note-title-icon')) return false;
    const titleEl = target?.closest<HTMLElement>('.inline-title');
    if (!titleEl) return false;
    if (!this.isMarkdownInlineTitle(titleEl)) return false;
    const file = this.resolveFileForInlineTitle(titleEl);
    if (!(file instanceof TFile)) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    // Prevent native inline editing of the rendered frontmatter title on press.
    // The following click (including keyboard-generated clicks) opens one core
    // file rename dialog. No delay, duplicate prompt or title writer is needed.
    if (event.type === 'click') void this.promptRenameTitle(file);
    return true;
  }

  prepareNativeInlineTitleFocus(event: FocusEvent): void {
    const node = event.target as Node | null;
    const target = node?.instanceOf(HTMLElement) ? node : null;
    if (target?.closest('.tps-gcm-note-title-icon')) return;
    const titleEl = target?.closest<HTMLElement>('.inline-title');
    if (!titleEl || !this.isMarkdownInlineTitle(titleEl)) return;
    const file = this.resolveFileForInlineTitle(titleEl);
    // Core commits an inline title on blur even without an input event. Feed
    // its existing keyboard editor the filename, never projected display text.
    if (file instanceof TFile) this.restoreFilenameInlineTitle(titleEl, file);
  }

  async promptRenameTitle(file: TFile): Promise<void> {
    if (!(file instanceof TFile)) return;
    const fileManager = this.plugin.app.fileManager as typeof this.plugin.app.fileManager & {
      promptForFileRename?: (file: TFile) => void | Promise<void>;
    };
    if (typeof fileManager.promptForFileRename !== 'function') {
      new Notice('Obsidian file renaming is unavailable in this version.');
      return;
    }
    logger.flow('NoteTitle', 'rename:prompt', { path: file.path, route: 'obsidian-file-rename' });
    try {
      // Core owns the input, validation, cancellation, path commit and link
      // updates. Its promise opens the dialog; it does not signal a rename.
      await fileManager.promptForFileRename(file);
    } catch (error) {
      logger.flowError('NoteTitle', 'rename:prompt-failed', error, { path: file.path });
      new Notice('Could not open Obsidian file renaming.');
    }
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
    if (link.dataset.tpsGcmRenderedTitle === visible && link.dataset.tpsGcmOriginalText) return true;
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
    if (titleEl.contains((titleEl.ownerDocument || document).activeElement)) return;
    if (isStrictSourceMode(view)) {
      this.restoreFilenameInlineTitle(titleEl, file);
      return;
    }
    const displayTitle = this.getDisplayTitle(file);
    if (!displayTitle) return;
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
      && !!(candidate.view as MarkdownView | undefined)?.contentEl
      && leafContent.contains((candidate.view as MarkdownView).contentEl),
    );
    const file = (leaf?.view as MarkdownView | undefined)?.file ?? null;
    return file instanceof TFile ? file : this.plugin.app.workspace.getActiveFile();
  }

  private isMarkdownInlineTitle(titleEl: HTMLElement): boolean {
    return !!titleEl.closest('.workspace-leaf-content[data-type="markdown"]');
  }

}
