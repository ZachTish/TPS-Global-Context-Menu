import { App } from 'obsidian';
import { TPS_EVENTS, TPS_LEGACY_EVENTS } from './tps-contracts';

export interface GcmEventsApi {
  emitFilesUpdated?: (paths: string[], options?: { sourcePluginId?: string }) => void;
}

export interface GcmApi {
  events?: GcmEventsApi;
  ui?: {
    shouldForceBaseLinkPreview?: () => boolean;
  };
}

export function getGcmApi(app: App): GcmApi | null {
  const plugins = (app as any)?.plugins;
  const plugin = plugins?.getPlugin?.('tps-global-context-menu')
    || plugins?.plugins?.['tps-global-context-menu']
    || plugins?.getPlugin?.('TPS-Global-Context-Menu (Dev)')
    || plugins?.plugins?.['TPS-Global-Context-Menu (Dev)'];
  return plugin?.api || null;
}

export function emitFilesUpdated(app: App, paths: string[], sourcePluginId: string): void {
  const normalized = paths.map((path) => String(path || '').trim()).filter(Boolean);
  if (!normalized.length) return;
  const api = getGcmApi(app);
  if (typeof api?.events?.emitFilesUpdated === 'function') {
    api.events.emitFilesUpdated(normalized, { sourcePluginId });
    return;
  }
  (app.workspace as any).trigger(TPS_LEGACY_EVENTS.GCM_FILES_UPDATED, normalized);
  (app.workspace as any).trigger(TPS_EVENTS.FILES_UPDATED, {
    sourcePluginId,
    timestamp: Date.now(),
    paths: normalized,
  });
}

export function shouldForceBaseLinkPreview(app: App): boolean {
  const api = getGcmApi(app);
  return typeof api?.ui?.shouldForceBaseLinkPreview === 'function'
    ? api.ui.shouldForceBaseLinkPreview() === true
    : false;
}
