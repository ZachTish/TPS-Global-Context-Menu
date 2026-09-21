import type { EventRef } from 'obsidian';
import { normalizePath } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { TPS_EVENTS, TPS_LEGACY_EVENTS } from '../tps-contracts';

export type GcmEventPayload = {
  sourcePluginId: string;
  timestamp: number;
  paths: string[];
  source?: string;
};

export class GcmEventService {
  // Both workspace names remain public. API subscribers receive our mirrored
  // pair only once, with the canonical source/timestamp, without time-window
  // deduplication that could swallow a second legitimate action.
  private readonly mirroredLegacyPayloads = new WeakSet<object>();
  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  normalizePaths(paths: unknown): string[] {
    const values = Array.isArray(paths) ? paths : paths == null ? [] : [paths];
    return values
      .map((path) => normalizePath(String(path || '').trim()))
      .filter(Boolean);
  }

  makePayload(paths: unknown, sourcePluginId = this.plugin.manifest.id): GcmEventPayload {
    return {
      sourcePluginId,
      timestamp: Date.now(),
      paths: this.normalizePaths(paths),
    };
  }

  emitFilesUpdated(paths: unknown, options?: { sourcePluginId?: string }): GcmEventPayload {
    const payload = this.makePayload(paths, options?.sourcePluginId);
    if (!payload.paths.length) return payload;
    this.emitPathPair(TPS_LEGACY_EVENTS.GCM_FILES_UPDATED, TPS_EVENTS.FILES_UPDATED, payload.paths, payload);
    return payload;
  }

  onFilesUpdated(callback: (paths: string[], payload: GcmEventPayload | Record<string, unknown>) => void): () => void {
    return this.onPathPayloadPair(TPS_LEGACY_EVENTS.GCM_FILES_UPDATED, TPS_EVENTS.FILES_UPDATED, callback);
  }

  emitExplicitAction(paths: unknown, options?: { sourcePluginId?: string; source?: string }): GcmEventPayload {
    const payload = {
      ...this.makePayload(paths, options?.sourcePluginId),
      source: options?.source || 'api',
    };
    if (!payload.paths.length) return payload;
    this.emitPathPair(TPS_LEGACY_EVENTS.GCM_EXPLICIT_ACTION, TPS_EVENTS.GCM_EXPLICIT_ACTION,
      { paths: payload.paths, source: payload.source }, payload);
    return payload;
  }

  onExplicitAction(callback: (paths: string[], payload: GcmEventPayload | Record<string, unknown>) => void): () => void {
    return this.onPathPayloadPair(
      TPS_LEGACY_EVENTS.GCM_EXPLICIT_ACTION,
      TPS_EVENTS.GCM_EXPLICIT_ACTION,
      callback,
    );
  }

  emitCalendarRefresh(paths: unknown, options?: { sourcePluginId?: string }): GcmEventPayload {
    const payload = this.makePayload(paths, options?.sourcePluginId);
    if (!payload.paths.length) return payload;
    this.emitPathPair(TPS_LEGACY_EVENTS.CALENDAR_EXPLICIT_REFRESH, TPS_EVENTS.CALENDAR_EXPLICIT_REFRESH, payload.paths, payload);
    return payload;
  }

  onCalendarRefresh(callback: (paths: string[], payload: GcmEventPayload | Record<string, unknown>) => void): () => void {
    return this.onPathPayloadPair(
      TPS_LEGACY_EVENTS.CALENDAR_EXPLICIT_REFRESH,
      TPS_EVENTS.CALENDAR_EXPLICIT_REFRESH,
      callback,
    );
  }

  emitCalendarSettingsChanged(options?: { sourcePluginId?: string }): Omit<GcmEventPayload, 'paths'> {
    const payload = {
      sourcePluginId: options?.sourcePluginId || this.plugin.manifest.id,
      timestamp: Date.now(),
    };
    this.plugin.app.workspace.trigger(TPS_LEGACY_EVENTS.CALENDAR_SETTINGS_CHANGED as any);
    this.plugin.app.workspace.trigger(TPS_EVENTS.CALENDAR_SETTINGS_CHANGED as any, payload);
    return payload;
  }

  emitDeleteComplete(): void {
    this.plugin.app.workspace.trigger(TPS_LEGACY_EVENTS.GCM_DELETE_COMPLETE as any);
  }

  private emitPathPair(legacyEvent: string, event: string, legacyPayload: object, payload: GcmEventPayload): void {
    this.mirroredLegacyPayloads.add(legacyPayload);
    try {
      this.plugin.app.workspace.trigger(legacyEvent as any, legacyPayload);
      this.plugin.app.workspace.trigger(event as any, payload);
    } finally {
      this.mirroredLegacyPayloads.delete(legacyPayload);
    }
  }

  private offref(ref: EventRef): void {
    this.plugin.app.workspace.offref(ref);
  }

  private onPathPayloadPair(
    legacyEvent: string,
    namespacedEvent: string,
    callback: (paths: string[], payload: GcmEventPayload | Record<string, unknown>) => void,
  ): () => void {
    const legacyRef = this.plugin.app.workspace.on(legacyEvent as any, ((payload: { paths?: string[] } | string[] | undefined) => {
      if (payload && this.mirroredLegacyPayloads.has(payload)) return;
      const normalized = this.normalizePaths(Array.isArray(payload) ? payload : payload?.paths);
      if (normalized.length) callback(normalized, Array.isArray(payload) ? this.makePayload(normalized) : { ...payload, paths: normalized });
    }) as any);
    const namespacedRef = this.plugin.app.workspace.on(namespacedEvent as any, ((payload: { paths?: string[] } | string[] | undefined) => {
      const normalized = this.normalizePaths(Array.isArray(payload) ? payload : payload?.paths);
      if (normalized.length) callback(normalized, Array.isArray(payload) ? this.makePayload(normalized) : { ...payload, paths: normalized });
    }) as any);
    return () => {
      this.offref(legacyRef);
      this.offref(namespacedRef);
    };
  }
}
