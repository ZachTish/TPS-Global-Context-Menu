import { TFile, type App, type EventRef, type MenuItem } from "obsidian";
import type {
  GcmMenuSink,
  NativeMenuLabelOptions,
} from "../menu/menu-builder";
import type { MenuController } from "../menu/menu-controller";
import * as logger from "../logger";

export const TPS_NOTEBOOK_NAVIGATOR_API_CHANGED_EVENT =
  "tps:notebook-navigator-api-changed";
export const TPS_NOTEBOOK_NAVIGATOR_API_REQUEST_EVENT =
  "tps:notebook-navigator-api-request";
export const TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID = "tps-notebook-navigator";
export const TPS_NOTEBOOK_NAVIGATOR_ENTITY_PROVIDER_ID = "tps/entity-types";
export const TPS_NOTEBOOK_NAVIGATOR_NOTE_ENTITY_KIND = "tps/entity-type/note";

interface NavigatorRowMenuTargetLike {
  readonly providerId: string;
  readonly kind: string;
  readonly file: NavigatorFileLike;
  readonly sourcePath: string;
  readonly sourceLineNumber?: number;
  readonly typeId: string | null;
  readonly checkbox?: unknown;
}

interface NavigatorFileLike {
  readonly path: string;
  readonly extension?: string;
  readonly stat?: {
    readonly ctime?: number;
  };
}

interface NavigatorRowMenuContextLike {
  readonly addItem: (callback: (item: MenuItem) => void) => void;
  readonly addSeparator: () => void;
  readonly target: NavigatorRowMenuTargetLike;
}

interface NavigatorFileMenuContextLike {
  readonly addItem: (callback: (item: MenuItem) => void) => void;
  readonly file: NavigatorFileLike;
  readonly selection: {
    readonly mode: "single" | "multiple";
    readonly files: readonly NavigatorFileLike[];
  };
}

interface NavigatorRowMenuRegistrationOptionsLike {
  readonly supports?: (target: NavigatorRowMenuTargetLike) => boolean;
}

interface NavigatorMenusApiLike {
  registerFileMenu?(
    callback: (context: NavigatorFileMenuContextLike) => void,
  ): () => void;
  registerRowMenu(
    callback: (context: NavigatorRowMenuContextLike) => void,
    options?: NavigatorRowMenuRegistrationOptionsLike,
  ): () => void;
}

interface NavigatorApiLike {
  readonly menus: NavigatorMenusApiLike;
}

interface NavigatorApiChangedPayloadLike {
  readonly source: "tps-notebook-navigator";
  readonly sourcePluginId: "tps-notebook-navigator";
  readonly hostInstanceId: string;
  readonly timestamp: number;
  readonly available: boolean;
  readonly api: NavigatorApiLike | null;
}

interface WorkspaceEventHost {
  on(name: string, callback: (payload: unknown) => void): EventRef;
  offref(ref: EventRef): void;
  trigger(name: string, payload: unknown): void;
}

export interface TpsNotebookNavigatorMenuBridgeHost {
  readonly app: App;
  readonly manifest: { readonly id: string };
  readonly settings: { readonly inlineMenuOnly?: boolean };
  readonly menuController: Pick<MenuController, "addToExactFileMenu">;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNavigatorFileLike(value: unknown): value is NavigatorFileLike {
  return isRecord(value) && typeof value.path === "string";
}

function isNavigatorMenusApi(value: unknown): value is NavigatorMenusApiLike {
  return (
    isRecord(value) &&
    typeof value.registerRowMenu === "function" &&
    (value.registerFileMenu === undefined ||
      typeof value.registerFileMenu === "function")
  );
}

function readNavigatorApiPayload(
  value: unknown,
): NavigatorApiChangedPayloadLike | null {
  if (!isRecord(value)) return null;
  if (
    value.source !== TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID ||
    value.sourcePluginId !== TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID ||
    typeof value.hostInstanceId !== "string" ||
    value.hostInstanceId.trim().length === 0 ||
    value.hostInstanceId.trim() !== value.hostInstanceId ||
    value.hostInstanceId.length > 128 ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp) ||
    typeof value.available !== "boolean"
  ) {
    return null;
  }
  if (!value.available) {
    return {
      source: TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
      sourcePluginId: TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
      hostInstanceId: value.hostInstanceId,
      timestamp: value.timestamp,
      available: false,
      api: null,
    };
  }
  if (!isRecord(value.api) || !isNavigatorMenusApi(value.api.menus))
    return null;
  return {
    source: TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
    sourcePluginId: TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
    hostInstanceId: value.hostInstanceId,
    timestamp: value.timestamp,
    available: true,
    api: { menus: value.api.menus },
  };
}

export function isBuiltInNoteEntityRowTarget(
  target: unknown,
): target is NavigatorRowMenuTargetLike {
  if (!isRecord(target)) return false;
  const typeId = typeof target.typeId === "string" ? target.typeId : "";
  return (
    target.providerId === TPS_NOTEBOOK_NAVIGATOR_ENTITY_PROVIDER_ID &&
    target.kind === TPS_NOTEBOOK_NAVIGATOR_NOTE_ENTITY_KIND &&
    isRecord(target.file) &&
    typeof target.file.path === "string" &&
    typeof target.sourcePath === "string" &&
    target.sourcePath === target.file.path &&
    target.sourceLineNumber === undefined &&
    (typeId === "entity:note" || typeId.startsWith("kind:"))
  );
}

/**
 * Owns GCM's optional registration with the co-installable TPS Navigator.
 * Registrations are runtime-only and replaced idempotently across hot reloads.
 */
export class TpsNotebookNavigatorMenuBridge {
  private readonly events: WorkspaceEventHost;
  private apiEventRef: EventRef | null = null;
  private menusApi: NavigatorMenusApiLike | null = null;
  private unregisterFileMenu: (() => void) | null = null;
  private unregisterRowMenu: (() => void) | null = null;
  private currentHostInstanceId: string | null = null;

  constructor(private readonly host: TpsNotebookNavigatorMenuBridgeHost) {
    this.events = host.app.workspace as unknown as WorkspaceEventHost;
  }

  start(): void {
    if (this.apiEventRef) return;
    this.apiEventRef = this.events.on(
      TPS_NOTEBOOK_NAVIGATOR_API_CHANGED_EVENT,
      (payload) => {
        this.acceptApiPayload(payload);
      },
    );
    try {
      this.events.trigger(
        TPS_NOTEBOOK_NAVIGATOR_API_REQUEST_EVENT,
        Object.freeze({
          sourcePluginId: this.host.manifest.id,
          timestamp: Date.now(),
          respond: (payload: unknown) => this.acceptApiPayload(payload),
        }),
      );
    } catch (error) {
      logger.flowWarn("TpsNotebookNavigatorMenuBridge", "api-request:failed", {
        error,
      });
    }
  }

  /** Re-evaluates setting-dependent action visibility without retaining stale registrations. */
  refresh(): void {
    const current = this.menusApi;
    if (!current) return;
    this.replaceRegistration(current, true);
  }

  stop(): void {
    this.releaseRegistration();
    this.currentHostInstanceId = null;
    const ref = this.apiEventRef;
    this.apiEventRef = null;
    if (!ref) return;
    try {
      this.events.offref(ref);
    } catch (error) {
      logger.flowWarn(
        "TpsNotebookNavigatorMenuBridge",
        "event-cleanup:failed",
        {
          error,
        },
      );
    }
  }

  private acceptApiPayload(value: unknown): void {
    const payload = readNavigatorApiPayload(value);
    if (!payload) return;
    if (!payload.available || !payload.api) {
      if (payload.hostInstanceId === this.currentHostInstanceId) {
        this.releaseRegistration();
        this.currentHostInstanceId = null;
      } else {
        logger.flow("TpsNotebookNavigatorMenuBridge", "api-payload:stale", {
          hostInstanceId: payload.hostInstanceId,
        });
      }
      return;
    }
    if (
      payload.hostInstanceId === this.currentHostInstanceId &&
      payload.api.menus === this.menusApi &&
      this.unregisterRowMenu &&
      (typeof payload.api.menus.registerFileMenu !== "function" ||
        this.unregisterFileMenu)
    ) {
      logger.flow("TpsNotebookNavigatorMenuBridge", "api-payload:stale", {
        hostInstanceId: payload.hostInstanceId,
      });
      return;
    }
    if (this.replaceRegistration(payload.api.menus, false)) {
      this.currentHostInstanceId = payload.hostInstanceId;
    }
  }

  private replaceRegistration(
    candidate: NavigatorMenusApiLike,
    force: boolean,
  ): boolean {
    if (
      !force &&
      this.menusApi === candidate &&
      this.unregisterRowMenu &&
      (typeof candidate.registerFileMenu !== "function" ||
        this.unregisterFileMenu)
    )
      return true;
    const previousFileUnregister = this.unregisterFileMenu;
    const previousUnregister = this.unregisterRowMenu;
    let candidateFileUnregister: (() => void) | null = null;
    let candidateUnregister: (() => void) | null = null;
    try {
      if (typeof candidate.registerFileMenu === "function") {
        candidateFileUnregister = candidate.registerFileMenu((context) =>
          this.addFileActions(context),
        );
        if (typeof candidateFileUnregister !== "function") {
          throw new Error(
            "TPS Notebook Navigator registerFileMenu() did not return a disposer.",
          );
        }
      }
      candidateUnregister = candidate.registerRowMenu(
        (context) => this.addNoteEntityActions(context),
        { supports: (target) => this.supportsTarget(target) },
      );
      if (typeof candidateUnregister !== "function") {
        throw new Error(
          "TPS Notebook Navigator registerRowMenu() did not return a disposer.",
        );
      }
    } catch (error) {
      try {
        candidateFileUnregister?.();
      } catch {
        // Best-effort cleanup of a partial foreign registration.
      }
      try {
        candidateUnregister?.();
      } catch {
        // Best-effort cleanup of a partial foreign registration.
      }
      logger.flowWarn("TpsNotebookNavigatorMenuBridge", "registration:failed", {
        error,
      });
      return false;
    }

    // Install the replacement before releasing the prior registration. A
    // malformed or throwing foreign API must not take down a working bridge.
    this.menusApi = candidate;
    this.unregisterFileMenu = candidateFileUnregister;
    this.unregisterRowMenu = candidateUnregister;
    this.disposeRegistration(previousFileUnregister);
    this.disposeRegistration(previousUnregister);
    logger.flow("TpsNotebookNavigatorMenuBridge", "registration:ready", {
      providerId: TPS_NOTEBOOK_NAVIGATOR_ENTITY_PROVIDER_ID,
      kind: TPS_NOTEBOOK_NAVIGATOR_NOTE_ENTITY_KIND,
      fileMenu: candidateFileUnregister !== null,
    });
    return true;
  }

  private supportsTarget(target: NavigatorRowMenuTargetLike): boolean {
    if (
      this.host.settings.inlineMenuOnly === true ||
      !isBuiltInNoteEntityRowTarget(target)
    )
      return false;
    const current = this.host.app.vault.getFileByPath(target.sourcePath);
    return (
      current instanceof TFile &&
      current.extension.toLowerCase() === "md" &&
      this.matchesCurrentFileSnapshot(target.file, current)
    );
  }

  private addNoteEntityActions(context: NavigatorRowMenuContextLike): void {
    if (!this.supportsTarget(context.target)) return;
    const current = this.host.app.vault.getFileByPath(
      context.target.sourcePath,
    );
    if (
      !(current instanceof TFile) ||
      current.extension.toLowerCase() !== "md" ||
      !this.matchesCurrentFileSnapshot(context.target.file, current)
    )
      return;

    const operations = this.buildExactFileActions([current], {
      includeTitle: false,
      includeDelete: false,
      excludeStandardTagProperties: true,
      includeSingleTargetActions: true,
    });
    if (!operations) return;
    for (const operation of operations) {
      if (operation.kind === "item") {
        context.addItem(operation.callback);
      } else {
        context.addSeparator();
      }
    }
  }

  private addFileActions(context: NavigatorFileMenuContextLike): void {
    if (this.host.settings.inlineMenuOnly === true) return;
    const files = this.resolveCurrentFileMenuSelection(context);
    if (!files) return;
    const operations = this.buildExactFileActions(files, {
      includeTitle: false,
      includeDelete: false,
      excludeStandardTagProperties: files.every(
        (file) => file.extension.toLowerCase() === "md",
      ),
      includeSingleTargetActions: files.length === 1,
    });
    if (!operations) return;

    // Navigator brackets extension items with its own separator and its public
    // file-menu facade intentionally exposes only addItem(). GCM sections stay
    // attached to their items; internal separator requests are safely omitted.
    for (const operation of operations) {
      if (operation.kind === "item") context.addItem(operation.callback);
    }
  }

  private resolveCurrentFileMenuSelection(
    context: NavigatorFileMenuContextLike,
  ): TFile[] | null {
    if (!isRecord(context) || !isNavigatorFileLike(context.file)) return null;
    const selection = context.selection;
    if (
      !isRecord(selection) ||
      (selection.mode !== "single" && selection.mode !== "multiple") ||
      !Array.isArray(selection.files)
    ) {
      return null;
    }
    if (
      (selection.mode === "single" && selection.files.length !== 1) ||
      (selection.mode === "multiple" && selection.files.length < 2)
    ) {
      return null;
    }

    const anchorPath = String(context.file.path || "");
    const currentAnchor = this.host.app.vault.getFileByPath(anchorPath);
    if (
      !(currentAnchor instanceof TFile) ||
      !this.matchesCurrentFileSnapshot(context.file, currentAnchor)
    ) {
      return null;
    }
    const seen = new Set<string>();
    const currentFiles: TFile[] = [];
    for (const snapshot of selection.files) {
      if (!isNavigatorFileLike(snapshot)) return null;
      const path = snapshot.path;
      if (!path || seen.has(path)) return null;
      const current = this.host.app.vault.getFileByPath(path);
      if (
        !(current instanceof TFile) ||
        !this.matchesCurrentFileSnapshot(snapshot, current)
      )
        return null;
      seen.add(path);
      currentFiles.push(current);
    }
    if (!seen.has(anchorPath)) return null;
    if (selection.mode === "single" && currentFiles[0]?.path !== anchorPath)
      return null;
    return currentFiles;
  }

  private buildExactFileActions(
    files: readonly TFile[],
    options: NativeMenuLabelOptions = {},
  ): Array<
    | { readonly kind: "item"; readonly callback: (item: MenuItem) => void }
    | { readonly kind: "separator" }
  > | null {
    // Build against a transaction-like sink first. Foreign menu hosts cannot
    // roll back already-added items, so flush only after the canonical GCM
    // builder completes successfully.
    const operations: Array<
      | { readonly kind: "item"; readonly callback: (item: MenuItem) => void }
      | { readonly kind: "separator" }
    > = [];
    const bufferedMenu: GcmMenuSink = {
      addItem: (callback) => operations.push({ kind: "item", callback }),
      addSeparator: () => operations.push({ kind: "separator" }),
    };
    try {
      this.host.menuController.addToExactFileMenu(bufferedMenu, files, options);
    } catch (error) {
      logger.flowWarn("TpsNotebookNavigatorMenuBridge", "menu-build:failed", {
        paths: files.map((file) => file.path),
        error,
      });
      return null;
    }
    return operations;
  }

  private matchesCurrentFileSnapshot(
    snapshot: NavigatorFileLike,
    current: TFile,
  ): boolean {
    if (snapshot.path !== current.path) return false;
    if (snapshot === current) return true;

    // A structurally valid TFile can cross a JavaScript realm. In that case,
    // the creation timestamp is the stable snapshot discriminator: it accepts
    // the same canonical note but rejects a delete/recreate at the same path.
    const snapshotCreated = snapshot.stat?.ctime;
    const currentCreated = current.stat?.ctime;
    return (
      typeof snapshotCreated === "number" &&
      Number.isFinite(snapshotCreated) &&
      typeof currentCreated === "number" &&
      Number.isFinite(currentCreated) &&
      snapshotCreated === currentCreated
    );
  }

  private releaseRegistration(): void {
    const unregisterFileMenu = this.unregisterFileMenu;
    const unregister = this.unregisterRowMenu;
    this.unregisterFileMenu = null;
    this.unregisterRowMenu = null;
    this.menusApi = null;
    this.disposeRegistration(unregisterFileMenu);
    this.disposeRegistration(unregister);
  }

  private disposeRegistration(unregister: (() => void) | null): void {
    if (!unregister) return;
    try {
      unregister();
    } catch (error) {
      logger.flowWarn(
        "TpsNotebookNavigatorMenuBridge",
        "registration-cleanup:failed",
        {
          error,
        },
      );
    }
  }
}
