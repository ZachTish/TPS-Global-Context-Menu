import { Component, TFile, type MenuItem } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';

type NotebookNavigatorFileMenuContext = {
  addItem: (callback: (item: MenuItem) => unknown) => unknown;
  file: TFile;
  selection: {
    mode: 'single' | 'multiple';
    files: readonly TFile[];
  };
};

type NotebookNavigatorMenuApi = {
  getVersion?: () => string;
  menus?: {
    registerFileMenu?: (
      callback: (context: NotebookNavigatorFileMenuContext) => void,
    ) => (() => void);
  };
};

type ActiveRegistration = {
  api: NotebookNavigatorMenuApi;
  deactivate: () => void;
};

/**
 * Lifecycle-safe bridge to Notebook Navigator's documented Menus API.
 * Missing or older providers fail closed; no DOM inference or global Menu hook is used.
 */
export class NotebookNavigatorMenuService extends Component {
  private active: ActiveRegistration | null = null;
  private lifecycleActive = false;
  private registeringApi: NotebookNavigatorMenuApi | null = null;
  private rejectedApi: NotebookNavigatorMenuApi | null = null;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    super();
  }

  onload(): void {
    this.lifecycleActive = true;
    const ensure = () => this.ensureRegistered();
    ensure();
    this.plugin.app.workspace.onLayoutReady(ensure);
    this.registerEvent(this.plugin.app.workspace.on('layout-change', ensure));
  }

  onunload(): void {
    this.lifecycleActive = false;
    this.clearRegistration();
  }

  ensureRegistered(): boolean {
    if (!this.lifecycleActive) {
      this.clearRegistration();
      return false;
    }
    let api: NotebookNavigatorMenuApi | null;
    try {
      api = this.resolveApi();
    } catch (error) {
      this.clearRegistration();
      logger.warn('[TPS GCM] Notebook Navigator API discovery failed', {
        error: logger.errorSummary(error),
      });
      return false;
    }
    const registerFileMenu = api?.menus?.registerFileMenu;
    if (!api || typeof registerFileMenu !== 'function') {
      this.clearRegistration();
      return false;
    }
    if (this.active?.api === api) return true;
    if (this.registeringApi) return false;

    this.clearRegistration();
    if (this.rejectedApi === api) return false;

    let callbackEnabled = true;
    let deactivated = false;
    let disposerCalled = false;
    let dispose: (() => void) | null = null;
    const deactivate = () => {
      callbackEnabled = false;
      deactivated = true;
      if (!dispose || disposerCalled) return;
      disposerCalled = true;
      try {
        dispose();
      } catch (error) {
        logger.warn('[TPS GCM] Notebook Navigator menu disposer failed', {
          error: logger.errorSummary(error),
        });
      }
    };

    this.registeringApi = api;
    let returnedDispose: unknown;
    try {
      returnedDispose = registerFileMenu.call(api.menus, (context) => {
        if (!callbackEnabled || this.active?.api !== api || this.plugin.settings.inlineMenuOnly) return;
        const files = this.resolveMenuFiles(context);
        if (files.length === 0) return;
        this.plugin.menuController.addToNotebookNavigatorMenu((callback) => context.addItem(callback), files, {
          includeDelete: false,
        });
      });
    } catch (error) {
      deactivate();
      this.rejectedApi = api;
      logger.warn('[TPS GCM] Notebook Navigator Menus API registration failed', {
        error: logger.errorSummary(error),
      });
      return false;
    } finally {
      if (this.registeringApi === api) this.registeringApi = null;
    }

    if (typeof returnedDispose !== 'function') {
      deactivate();
      this.rejectedApi = api;
      logger.warn('[TPS GCM] Notebook Navigator returned no menu disposer; its contribution was disabled');
      return false;
    }
    dispose = returnedDispose as () => void;
    if (deactivated) deactivate();

    let currentApi: NotebookNavigatorMenuApi | null = null;
    try {
      currentApi = this.resolveApi();
    } catch (error) {
      logger.warn('[TPS GCM] Notebook Navigator API revalidation failed', {
        error: logger.errorSummary(error),
      });
    }
    if (!this.lifecycleActive || currentApi !== api || !callbackEnabled) {
      deactivate();
      return false;
    }

    this.rejectedApi = null;
    this.active = { api, deactivate };
    let apiVersion = 'unknown';
    if (typeof api.getVersion === 'function') {
      try {
        apiVersion = api.getVersion();
      } catch (error) {
        logger.warn('[TPS GCM] Notebook Navigator API version read failed', {
          error: logger.errorSummary(error),
        });
      }
    }
    logger.log('[TPS GCM] Registered Notebook Navigator file-menu contribution', { apiVersion });
    return true;
  }

  private resolveApi(): NotebookNavigatorMenuApi | null {
    const api = (this.plugin.app as any)?.plugins?.plugins?.['notebook-navigator']?.api;
    return api && typeof api === 'object' ? api as NotebookNavigatorMenuApi : null;
  }

  private resolveMenuFiles(context: NotebookNavigatorFileMenuContext): TFile[] {
    const source = context?.selection?.mode === 'multiple'
      ? context.selection.files
      : [context?.file];
    const files: TFile[] = [];
    const seen = new Set<string>();
    for (const candidate of source || []) {
      if (!(candidate instanceof TFile) || !candidate.path || seen.has(candidate.path)) continue;
      seen.add(candidate.path);
      files.push(candidate);
    }
    return files;
  }

  private clearRegistration(): void {
    const active = this.active;
    this.active = null;
    active?.deactivate();
  }
}
