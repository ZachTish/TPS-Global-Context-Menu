import { Component, MarkdownRenderer, MarkdownView, TFile, normalizePath } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import type { VirtualBaseEmbedPlacement, VirtualBaseEmbedProperty } from '../types';
import * as logger from '../logger';

type MountedEmbed = {
  component: Component;
  host: HTMLElement;
};

type RenderSurface = {
  root: HTMLElement;
  mode: 'reading' | 'live-preview';
};

const DEFAULT_VIRTUAL_BASE_EMBED_PROPERTIES: VirtualBaseEmbedProperty[] = [
  { key: 'gcmBaseTop', placement: 'top' },
  { key: 'gcmBaseBottom', placement: 'bottom' },
  { key: 'gcmBaseHover', placement: 'hover' },
];

export class VirtualBaseEmbedService extends Component {
  private mountedByView = new WeakMap<MarkdownView, MountedEmbed[]>();
  private refreshTimer: number | null = null;

  constructor(private plugin: TPSGlobalContextMenuPlugin) {
    super();
  }

  onload(): void {
    this.registerEvent(this.plugin.app.workspace.on('layout-change', () => this.scheduleRefresh()));
    this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => this.scheduleRefresh(40)));
    this.registerEvent(this.plugin.app.metadataCache.on('changed', (file) => {
      if (file instanceof TFile) this.refreshFile(file);
    }));
    this.plugin.app.workspace.onLayoutReady(() => this.refreshAll());
  }

  onunload(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.clearAll();
  }

  scheduleRefresh(delayMs = 120): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshAll();
    }, delayMs);
  }

  refreshAll(): void {
    if (this.plugin.settings.enableVirtualBaseEmbeds === false) {
      this.clearAll();
      return;
    }

    const seen = new Set<MarkdownView>();
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) return;
      if (view.getViewType?.() !== 'markdown') return;
      if (!(view.file instanceof TFile) || view.file.extension !== 'md') {
        this.clearView(view);
        return;
      }
      seen.add(view);
      void this.refreshView(view);
    });

    for (const view of this.getMountedViews()) {
      if (!seen.has(view)) this.clearView(view);
    }
  }

  refreshFile(file: TFile): void {
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path) {
        void this.refreshView(view);
      }
    });
  }

  private async refreshView(view: MarkdownView): Promise<void> {
    const file = view.file;
    if (!(file instanceof TFile) || file.extension !== 'md') {
      this.clearView(view);
      return;
    }

    const targetsByPlacement = this.resolveTargetsByPlacement(file);
    if (!targetsByPlacement.top.length && !targetsByPlacement.bottom.length && !targetsByPlacement.hover.length) {
      this.clearView(view);
      return;
    }

    const surface = this.resolveRenderSurface(view);
    if (!surface) {
      this.clearView(view);
      return;
    }

    this.clearView(view);

    const mounts: MountedEmbed[] = [];
    this.mountedByView.set(view, mounts);

    if (targetsByPlacement.top.length) {
      const host = this.createHost('top', file, targetsByPlacement.top);
      this.insertTopHost(surface, host);
      const mount = await this.renderHost(host, file, targetsByPlacement.top, surface.mode);
      this.installHostRemovalWatcher(surface.root, mount);
      mounts.push(mount);
    }

    if (targetsByPlacement.hover.length) {
      const host = this.createHost('hover', file, targetsByPlacement.hover);
      this.insertTopHost(surface, host);
      const mount = await this.renderHost(host, file, targetsByPlacement.hover, surface.mode);
      this.installHostRemovalWatcher(surface.root, mount);
      mounts.push(mount);
    }

    if (targetsByPlacement.bottom.length) {
      const host = this.createHost('bottom', file, targetsByPlacement.bottom);
      const target = this.findBottomInsertionTarget(surface) ?? surface.root;
      target.appendChild(host);
      const mount = await this.renderHost(host, file, targetsByPlacement.bottom, surface.mode);
      this.installHostRemovalWatcher(surface.root, mount);
      mounts.push(mount);
    }
  }

  private resolveRenderSurface(view: MarkdownView): RenderSurface | null {
    const contentEl = view.contentEl;
    const previewRoots = Array.from(contentEl.querySelectorAll<HTMLElement>(
      '.markdown-preview-view, .markdown-reading-view, .markdown-rendered',
    ));
    const visiblePreviewRoot = previewRoots.find((root) => this.isVisibleRenderRoot(root));
    if (visiblePreviewRoot) return { root: visiblePreviewRoot, mode: 'reading' };

    const livePreviewRoot = contentEl.querySelector<HTMLElement>('.markdown-source-view');
    if (livePreviewRoot && this.isLivePreviewRoot(livePreviewRoot) && this.isVisibleRenderRoot(livePreviewRoot)) {
      return { root: livePreviewRoot, mode: 'live-preview' };
    }

    return null;
  }

  private isLivePreviewRoot(root: HTMLElement): boolean {
    if (root.classList.contains('is-source-mode')) return false;
    return root.classList.contains('is-live-preview') || root.matches('.markdown-source-view');
  }

  private isVisibleRenderRoot(root: HTMLElement): boolean {
    const style = window.getComputedStyle(root);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (root.closest('.workspace-leaf.mod-hidden, .mod-hidden')) return false;
    const rect = root.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  private resolveTargetsByPlacement(file: TFile): Record<VirtualBaseEmbedPlacement, TFile[]> {
    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    const targets: Record<VirtualBaseEmbedPlacement, TFile[]> = { top: [], bottom: [], hover: [] };
    if (!frontmatter || typeof frontmatter !== 'object') return targets;

    for (const config of this.getEmbedProperties()) {
      const key = String(config.key || '').trim();
      if (!key) continue;
      const actualKey = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      if (!actualKey) continue;
      for (const value of this.flattenFrontmatterValue(frontmatter[actualKey])) {
        const baseFile = this.resolveBaseFile(value, file.path);
        if (!baseFile) continue;
        if (!targets[config.placement].some((existing) => existing.path === baseFile.path)) {
          targets[config.placement].push(baseFile);
        }
      }
    }

    return targets;
  }

  private getEmbedProperties(): VirtualBaseEmbedProperty[] {
    const configured = Array.isArray(this.plugin.settings.virtualBaseEmbedProperties)
      ? this.plugin.settings.virtualBaseEmbedProperties
      : [];
    const normalized = configured
      .map((entry) => ({
        key: String(entry?.key || '').trim(),
        placement: entry?.placement,
      }))
      .filter((entry): entry is VirtualBaseEmbedProperty =>
        !!entry.key && (entry.placement === 'top' || entry.placement === 'bottom' || entry.placement === 'hover'),
      );
    return normalized.length ? normalized : DEFAULT_VIRTUAL_BASE_EMBED_PROPERTIES;
  }

  private flattenFrontmatterValue(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.flattenFrontmatterValue(entry));
    }
    const raw = String(value ?? '').trim();
    if (!raw) return [];
    return raw
      .split(/\r?\n|,/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  private resolveBaseFile(rawValue: string, sourcePath: string): TFile | null {
    const cleaned = rawValue
      .replace(/^!\s*/, '')
      .replace(/^\[\[/, '')
      .replace(/\]\]$/, '')
      .replace(/^\[/, '')
      .replace(/\]\([^)]+\)$/, '')
      .split('|')[0]
      .split('#')[0]
      .trim();
    if (!cleaned) return null;
    const withExtension = cleaned.toLowerCase().endsWith('.base') ? cleaned : `${cleaned}.base`;
    const direct = this.plugin.app.vault.getAbstractFileByPath(normalizePath(withExtension));
    if (direct instanceof TFile && direct.extension === 'base') return direct;
    const linked = this.plugin.app.metadataCache.getFirstLinkpathDest(withExtension.replace(/\.base$/i, ''), sourcePath)
      ?? this.plugin.app.metadataCache.getFirstLinkpathDest(withExtension, sourcePath);
    return linked instanceof TFile && linked.extension === 'base' ? linked : null;
  }

  private createHost(placement: VirtualBaseEmbedPlacement, sourceFile: TFile, baseFiles: TFile[]): HTMLElement {
    const host = document.createElement('div');
    host.className = `tps-gcm-virtual-base-embed tps-gcm-virtual-base-embed--${placement}`;
    host.dataset.tpsGcmVirtualBasePlacement = placement;
    host.dataset.tpsGcmVirtualBaseSource = sourceFile.path;
    host.dataset.tpsGcmVirtualBaseTargets = baseFiles.map((file) => file.path).join('|');
    host.contentEditable = 'false';
    return host;
  }

  private async renderHost(host: HTMLElement, sourceFile: TFile, baseFiles: TFile[], mode: RenderSurface['mode']): Promise<MountedEmbed> {
    const component = new Component();
    component.load();
    for (const baseFile of baseFiles) {
      const item = document.createElement('div');
      item.className = 'tps-gcm-virtual-base-embed-item';
      item.dataset.tpsGcmVirtualBaseTarget = baseFile.path;
      item.dataset.path = baseFile.path;
      item.dataset.src = baseFile.path;
      item.contentEditable = 'false';
      host.appendChild(item);
      try {
        await MarkdownRenderer.render(this.plugin.app, `![[${baseFile.path}]]`, item, sourceFile.path, component);
        logger.debug('[VirtualBaseEmbed] rendered base', {
          source: sourceFile.path,
          target: baseFile.path,
          placement: host.dataset.tpsGcmVirtualBasePlacement,
          mode,
        });
      } catch (error) {
        logger.error('[VirtualBaseEmbed] failed to render base', {
          source: sourceFile.path,
          target: baseFile.path,
          error,
        });
      }
      this.installBaseItemClassifier(item, component);
    }
    return { component, host };
  }

  private installBaseItemClassifier(item: HTMLElement, component: Component): void {
    const classify = () => this.classifyBaseItem(item);
    const observer = new MutationObserver(() => window.requestAnimationFrame(classify));
    observer.observe(item, { childList: true, subtree: true, characterData: true, attributes: true });
    component.register(() => observer.disconnect());

    for (const delay of [0, 120, 500, 1200]) {
      const timer = window.setTimeout(classify, delay);
      component.register(() => window.clearTimeout(timer));
    }
  }

  private installHostRemovalWatcher(root: HTMLElement, mount: MountedEmbed): void {
    const observer = new MutationObserver(() => {
      if (document.body.contains(mount.host)) return;
      observer.disconnect();
      this.scheduleRefresh(40);
    });
    observer.observe(root, { childList: true, subtree: true });
    mount.component.register(() => observer.disconnect());
  }

  private classifyBaseItem(item: HTMLElement): void {
    this.classifyInlineEmptyStates(item);
    const text = (item.textContent || '').replace(/\s+/g, ' ').trim();
    const hasNoNotesEmptyState = /\bNo notes to display\b/i.test(text);
    const hasTaskCreationSurface = /\bAdd task\b/i.test(text);
    const hasKanbanSurface = !!item.querySelector('.tps-kanban-root, .tps-kanban-container, .tps-kanban-board, .tps-kanban-lane');
    item.classList.toggle('tps-gcm-virtual-base-embed-item--empty', hasNoNotesEmptyState && !hasTaskCreationSurface && !hasKanbanSurface);
  }

  private classifyInlineEmptyStates(item: HTMLElement): void {
    const targets = new Set<HTMLElement>();

    for (const el of Array.from(item.querySelectorAll<HTMLElement>('*'))) {
      if (this.normalizeElementText(el) !== 'No notes to display') continue;
      let target = el;
      while (
        target.parentElement
        && target.parentElement !== item
        && this.normalizeElementText(target.parentElement) === 'No notes to display'
      ) {
        target = target.parentElement;
      }
      targets.add(target);
    }

    item.querySelectorAll<HTMLElement>('.tps-gcm-virtual-base-empty-state-inline').forEach((el) => {
      if (!targets.has(el)) el.classList.remove('tps-gcm-virtual-base-empty-state-inline');
    });
    targets.forEach((target) => {
      if (!target.classList.contains('tps-gcm-virtual-base-empty-state-inline')) {
        target.classList.add('tps-gcm-virtual-base-empty-state-inline');
      }
    });
  }

  private normalizeElementText(el: HTMLElement): string {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  private insertTopHost(surface: RenderSurface, host: HTMLElement): void {
    if (surface.mode === 'live-preview') {
      this.insertLivePreviewTopHost(surface, host);
      return;
    }

    const target = surface.root.querySelector<HTMLElement>('.markdown-preview-sizer') ?? surface.root;
    const markers = Array.from(target.children)
      .filter((el): el is HTMLElement => el instanceof HTMLElement)
      .filter((el) => el.matches('.metadata-container, .metadata-properties, .tps-gcm-top-parent-nav, .inline-title, h1'));
    const marker = markers.at(-1);
    if (marker?.parentElement) {
      marker.insertAdjacentElement('afterend', host);
      return;
    }
    target.appendChild(host);
  }

  private insertLivePreviewTopHost(surface: RenderSurface, host: HTMLElement): void {
    const target =
      surface.root.querySelector<HTMLElement>('.cm-sizer')
      ?? surface.root.querySelector<HTMLElement>('.cm-content')
      ?? surface.root.querySelector<HTMLElement>('.cm-contentContainer')
      ?? surface.root.querySelector<HTMLElement>('.cm-scroller')
      ?? surface.root;
    const directChildren = Array.from(target.children).filter((el): el is HTMLElement => el instanceof HTMLElement);
    const markers = directChildren.filter((el) =>
      el.matches('.metadata-container, .metadata-properties, .inline-title, .cm-line.inline-title, .HyperMD-header-1, .cm-line:has(.cm-header-1)'),
    );
    const marker = markers.at(-1);
    if (marker?.parentElement) {
      marker.insertAdjacentElement('afterend', host);
      return;
    }
    target.insertBefore(host, target.firstElementChild);
  }

  private findBottomInsertionTarget(surface: RenderSurface): HTMLElement | null {
    if (surface.mode === 'live-preview') {
      return surface.root.querySelector<HTMLElement>('.cm-content')
        ?? surface.root.querySelector<HTMLElement>('.cm-sizer')
        ?? surface.root.querySelector<HTMLElement>('.cm-contentContainer')
        ?? surface.root.querySelector<HTMLElement>('.cm-scroller')
        ?? surface.root;
    }
    return surface.root.querySelector<HTMLElement>('.markdown-preview-sizer') ?? surface.root;
  }

  private clearAll(): void {
    for (const view of this.getMountedViews()) this.clearView(view);
    document.querySelectorAll<HTMLElement>('.tps-gcm-virtual-base-embed').forEach((el) => el.remove());
  }

  private clearView(view: MarkdownView): void {
    const mounts = this.mountedByView.get(view) || [];
    for (const mount of mounts) {
      mount.component.unload();
      mount.host.remove();
    }
    this.mountedByView.delete(view);
    view.contentEl?.querySelectorAll<HTMLElement>('.tps-gcm-virtual-base-embed').forEach((el) => el.remove());
  }

  private getMountedViews(): MarkdownView[] {
    const views: MarkdownView[] = [];
    this.plugin.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && this.mountedByView.has(view)) views.push(view);
    });
    return views;
  }
}
