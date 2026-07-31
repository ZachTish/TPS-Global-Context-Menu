import { Notice, TFile, normalizePath, parseYaml } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import {
  BASE_LINE_EDIT_PROTOCOL_ACTION,
  MAX_BASE_DEFINITION_BYTES,
  MAX_BASE_LINE_SOURCE_BYTES,
  isWithinUtf8ByteLimit,
  resolveUniqueBaseLineFingerprint,
  validateBaseLineEditProtocolParams,
} from './base-line-edit-protocol-core';

const RECENT_NONCE_WINDOW_MS = 5 * 60 * 1000;
const MAX_RECENT_NONCES = 256;

export class BaseLineEditProtocolService {
  private readonly activeNonces = new Set<string>();
  private readonly recentNonces = new Map<string, number>();

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  register(): void {
    this.plugin.registerObsidianProtocolHandler(BASE_LINE_EDIT_PROTOCOL_ACTION, (params) => {
      void this.handleProtocolData(params as Record<string, unknown>);
    });
  }

  async handleProtocolData(input: Record<string, unknown>): Promise<boolean> {
    if (input?.action !== BASE_LINE_EDIT_PROTOCOL_ACTION) {
      this.reject('invalid-action');
      return false;
    }
    const query = { ...input };
    delete query.action;
    return this.handle(query);
  }

  async handle(input: Record<string, unknown>): Promise<boolean> {
    const validation = validateBaseLineEditProtocolParams(input);
    if (validation.ok === false) {
      this.reject('invalid-parameters', validation.reason);
      return false;
    }
    const params = validation.value;
    if (params.vault !== this.plugin.app.vault.getName()) {
      this.reject('wrong-vault');
      return false;
    }

    const now = Date.now();
    this.pruneRecentNonces(now);
    if (this.activeNonces.has(params.nonce) || (this.recentNonces.get(params.nonce) || 0) > now) {
      logger.flowWarn('BaseLineEditRoute', 'route:duplicate', { version: 1 });
      return false;
    }
    this.activeNonces.add(params.nonce);

    try {
      const baseFile = this.plugin.app.vault.getAbstractFileByPath(params.base);
      if (!(baseFile instanceof TFile) || baseFile.extension.toLowerCase() !== 'base') {
        this.reject('base-unavailable');
        return false;
      }
      if (normalizePath(baseFile.path) !== params.base) {
        this.reject('base-path-mismatch');
        return false;
      }
      const baseContent = await this.plugin.app.vault.cachedRead(baseFile);
      if (!isWithinUtf8ByteLimit(baseContent, MAX_BASE_DEFINITION_BYTES)) {
        this.reject('base-too-large');
        return false;
      }
      const baseDefinition = parseYaml(baseContent) as Record<string, unknown> | null | undefined;
      const views = Array.isArray(baseDefinition?.views) ? baseDefinition.views : [];
      const exactViewCount = views.filter((candidate) => (
        candidate != null
        && typeof candidate === 'object'
        && typeof (candidate as Record<string, unknown>).name === 'string'
        && (candidate as Record<string, unknown>).name === params.view
      )).length;
      if (exactViewCount !== 1) {
        this.reject(exactViewCount === 0 ? 'view-unavailable' : 'view-ambiguous');
        return false;
      }

      const sourceFile = this.plugin.app.vault.getAbstractFileByPath(params.source);
      if (!(sourceFile instanceof TFile) || sourceFile.extension.toLowerCase() !== 'md') {
        this.reject('source-unavailable');
        return false;
      }
      if (normalizePath(sourceFile.path) !== params.source) {
        this.reject('source-path-mismatch');
        return false;
      }

      try {
        await this.plugin.app.workspace.openLinkText(`${params.base}#${params.view}`, '', false);
      } catch {
        this.reject('base-open-failed');
        return false;
      }

      const content = await this.plugin.app.vault.read(sourceFile);
      if (!isWithinUtf8ByteLimit(content, MAX_BASE_LINE_SOURCE_BYTES)) {
        this.reject('source-too-large');
        return false;
      }
      const resolution = await resolveUniqueBaseLineFingerprint(content, params.fingerprint, params.line);
      if (resolution.status !== 'unique') {
        this.reject(resolution.status === 'ambiguous' ? 'line-ambiguous' : 'line-unavailable');
        return false;
      }

      logger.flow('BaseLineEditRoute', 'route:modal-open', {
        version: 1,
        relocated: resolution.relocated,
      });
      const saved = await this.plugin.homeCaptureService.openLineEditor(sourceFile, resolution.zeroBasedLine, {
        expectedFingerprint: params.fingerprint,
        redactDiagnostics: true,
      });
      logger.flow('BaseLineEditRoute', 'route:completed', {
        version: 1,
        relocated: resolution.relocated,
        saved,
      });
      return true;
    } catch {
      this.reject('unexpected-failure');
      return false;
    } finally {
      this.activeNonces.delete(params.nonce);
      this.recentNonces.set(params.nonce, Date.now() + RECENT_NONCE_WINDOW_MS);
      this.capRecentNonces();
    }
  }

  private reject(reason: string, detail?: string): void {
    logger.flowWarn('BaseLineEditRoute', 'route:rejected', {
      version: 1,
      reason,
      ...(detail ? { detail } : {}),
    });
    this.showInvalidLinkNotice();
  }

  private showInvalidLinkNotice(): void {
    new Notice('TishOS could not open this Base line safely. Refresh the widget and try again.', 8000);
  }

  private pruneRecentNonces(now: number): void {
    for (const [nonce, expiresAt] of this.recentNonces.entries()) {
      if (expiresAt <= now) this.recentNonces.delete(nonce);
    }
  }

  private capRecentNonces(): void {
    while (this.recentNonces.size > MAX_RECENT_NONCES) {
      const oldest = this.recentNonces.keys().next().value as string | undefined;
      if (!oldest) break;
      this.recentNonces.delete(oldest);
    }
  }
}
