import { TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { findKeyCaseInsensitive, setValueCaseInsensitive } from '../core';

export type LegacyCalendarIdentity = {
  eventId: string;
  uid: string;
  sourceUrl: string;
  externalId: string | null;
};

export type CalendarIdentityInput = {
  id?: string | null;
  uid?: string | null;
  url?: string | null;
  sourceUrl?: string | null;
};

export class TpsIdentityService {
  readonly internalIdKey = 'tpsId';
  readonly externalIdKey = 'externalId';

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  getInternalId(frontmatter: Record<string, unknown> | null | undefined): string | null {
    if (!frontmatter) return null;
    const key = findKeyCaseInsensitive(frontmatter, this.internalIdKey) || findKeyCaseInsensitive(frontmatter, 'subitemId');
    const value = key ? String(frontmatter[key] ?? '').trim() : '';
    return value || null;
  }

  setInternalId(frontmatter: Record<string, unknown>, id: string): string {
    const clean = String(id || '').trim() || this.createInternalId();
    setValueCaseInsensitive(frontmatter, this.internalIdKey, clean);
    return clean;
  }

  ensureInternalIdInFrontmatter(frontmatter: Record<string, unknown>): string {
    return this.getInternalId(frontmatter) || this.setInternalId(frontmatter, this.createInternalId());
  }

  async ensureInternalId(file: TFile): Promise<string> {
    let id = '';
    await this.plugin.frontmatterMutationService.process(file, (frontmatter) => {
      id = this.ensureInternalIdInFrontmatter(frontmatter);
    });
    return id;
  }

  getExternalId(frontmatter: Record<string, unknown> | null | undefined): string | null {
    if (!frontmatter) return null;
    const key = findKeyCaseInsensitive(frontmatter, this.externalIdKey);
    const value = key ? String(frontmatter[key] ?? '').trim() : '';
    return value || null;
  }

  setExternalId(frontmatter: Record<string, unknown>, externalId: string): string {
    const clean = String(externalId || '').trim();
    if (clean) setValueCaseInsensitive(frontmatter, this.externalIdKey, clean);
    return clean;
  }

  buildCalendarExternalId(event: CalendarIdentityInput): string {
    const eventId = this.normalizeIdentityValue(event.id);
    const sourceUrl = this.normalizeCalendarUrl(event.sourceUrl);
    if (eventId) return this.buildSourceScopedCalendarExternalId(sourceUrl, eventId);
    return this.normalizeIdentityValue(event.url);
  }

  readLegacyCalendarIdentity(frontmatter: Record<string, unknown> | null | undefined): LegacyCalendarIdentity | null {
    if (!frontmatter) return null;
    const eventId = this.normalizeIdentityValue(this.readCaseInsensitive(frontmatter, 'externalEventId'));
    const uid = this.normalizeIdentityValue(this.readCaseInsensitive(frontmatter, 'tpsCalendarUid'));
    const sourceUrl = this.normalizeCalendarUrl(this.readCaseInsensitive(frontmatter, 'tpsCalendarSourceUrl'));
    if (!eventId && !uid && !sourceUrl) return null;
    return {
      eventId,
      uid,
      sourceUrl,
      externalId: eventId ? this.buildSourceScopedCalendarExternalId(sourceUrl, eventId) : null,
    };
  }

  buildSourceScopedCalendarExternalId(sourceUrl: string, eventId: string): string {
    return `calendar:${this.normalizeCalendarUrl(sourceUrl)}#${this.normalizeIdentityValue(eventId)}`;
  }

  createInternalId(): string {
    const cryptoApi = (globalThis as any).crypto;
    const raw = typeof cryptoApi?.randomUUID === 'function'
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `item_${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  }

  private normalizeIdentityValue(value: unknown): string {
    return String(value ?? '').trim();
  }

  private normalizeCalendarUrl(value: unknown): string {
    return String(value ?? '').trim().replace(/\/+$/, '');
  }

  private readCaseInsensitive(frontmatter: Record<string, unknown>, key: string): unknown {
    const actual = findKeyCaseInsensitive(frontmatter, key);
    return actual ? frontmatter[actual] : undefined;
  }
}
