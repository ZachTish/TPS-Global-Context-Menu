import { QueryController, TFile } from 'obsidian';
import { around } from 'monkey-around';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';

/** The 1.14 native menu writes frontmatter immediately before its platform-specific UI. */
export function supportsNativeCreateBoundary(open: Function): boolean {
  const source = Function.prototype.toString.call(open);
  const create = source.indexOf('.createNewFile(');
  const write = source.indexOf('.processFrontMatter(');
  return create >= 0 && write > create && source.indexOf('.openFile(', write) > write;
}

/** A per-invocation facade: no vault, file-manager, or workspace method is patched globally. */
export async function runNativeCreateWithoutOpening(
  menu: any,
  original: (...args: any[]) => Promise<void>,
  args: any[],
): Promise<TFile | null> {
  let created: TFile | null = null;
  let completed = false;
  const complete = {};
  const manager = menu.app.fileManager;
  const facade = new Proxy(manager, {
    get(target, key) {
      if (key === 'createNewFile') return async (...values: any[]) => {
        if (created) throw new Error('Native Base create attempted more than one file.');
        const file = await manager.createNewFile(...values);
        created = file;
        return file;
      };
      if (key === 'processFrontMatter') return async (file: TFile, ...values: any[]) => {
        const result = await manager.processFrontMatter(file, ...values);
        if (file === created) throw complete;
        return result;
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const invocation = Object.create(menu);
  invocation.app = new Proxy(menu.app, {
    get(target, key) {
      if (key === 'fileManager') return facade;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try { await original.apply(invocation, args); }
  catch (error) {
    if (error !== complete) throw error;
    completed = true;
  }
  return completed ? created : null;
}

export class NativeBaseNoteOpening {
  private cleanups: (() => void)[] = [];
  private prototypes = new WeakSet<object>();
  private active = true;
  private warned = false;
  private inFlight = new WeakSet<object>();
  constructor(private plugin: TPSGlobalContextMenuPlugin) {}

  install(): void {
    const owner = this;
    const prototype = QueryController?.prototype as any;
    if (!prototype) return;
    this.cleanups.push(around(prototype, {
      onload: original => function(this: any, ...args: any[]) {
        owner.attach(this);
        return original.apply(this, args);
      },
      update: original => function(this: any, ...args: any[]) {
        owner.attach(this);
        return original.apply(this, args);
      },
    }));
    // Existing embedded and standalone controllers live in Obsidian's component tree.
    const seen = new Set<object>();
    const visit = (node: any) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (node instanceof QueryController) this.attach(node);
      for (const child of Array.isArray(node._children) ? node._children : []) visit(child);
      for (const key of ['view', 'controller', 'previewMode', 'renderer', 'editMode']) visit(node[key]);
    };
    visit(this.plugin.app.workspace);
    this.plugin.app.workspace.iterateAllLeaves(leaf => visit(leaf.view));
  }

  attach(controller: any): boolean {
    const menu = controller?.newItemMenu;
    if (!menu || typeof menu.open !== 'function') return false;
    const prototype = Object.getPrototypeOf(menu);
    if (this.prototypes.has(prototype)) return true;
    if (!supportsNativeCreateBoundary(menu.open)) {
      if (!this.warned) {
        this.warned = true;
        logger.warn('Native Base creation adapter unavailable; preserving the native creation handler.');
      }
      return false;
    }
    this.prototypes.add(prototype);
    const owner = this;
    this.cleanups.push(around(prototype, {
      open: original => async function(this: any, ...args: any[]) {
        if (!owner.active || this.app !== owner.plugin.app || !this.query || !this.viewConfig) return original.apply(this, args);
        if (owner.inFlight.has(this)) return;
        owner.inFlight.add(this);
        const sourceLeaf = owner.plugin.app.workspace.activeLeaf;
        try {
          const file = await runNativeCreateWithoutOpening(this, original, args);
          if (file && owner.active) await owner.plugin.noteOpeningService.present({
            filePath: file.path, sourcePluginId: 'obsidian-bases', anchorEl: this.containerEl,
            sourceLeaf, renameTitle: true,
          });
        } catch (error) {
          // Never retry a creation that may already have written its file.
          logger.flowError('NoteOpening', 'native-base:create-failed', error);
          throw error;
        } finally { owner.inFlight.delete(this); }
      },
    }));
    return true;
  }

  dispose(): void {
    this.active = false;
    for (const cleanup of this.cleanups.reverse()) cleanup();
    this.cleanups = [];
  }
}
