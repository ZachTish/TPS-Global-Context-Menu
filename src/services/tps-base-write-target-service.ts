import { TFile, normalizePath, type App } from 'obsidian';
import type { TpsBaseWriteFallbackMode } from '../types';

export type TpsBaseWriteTargetSource = 'filter' | 'today-daily-note' | 'specific-note' | null;

export type TpsBaseWriteTargetReason =
  | 'resolved'
  | 'filter-required'
  | 'invalid-filter-target'
  | 'filter-target-not-found'
  | 'filter-target-not-markdown'
  | 'filter-target-create-failed'
  | 'specific-note-not-configured'
  | 'specific-note-not-found'
  | 'specific-note-not-markdown'
  | 'daily-note-unavailable';

export interface TpsBaseWriteTargetResolution {
  file: TFile | null;
  source: TpsBaseWriteTargetSource;
  path: string | null;
  reason: TpsBaseWriteTargetReason;
  error?: unknown;
}

export interface ResolveTpsBaseWriteTargetOptions {
  explicitTargetPath?: unknown;
  explicitTargetSpecified?: boolean;
  createExplicitIfMissing?: boolean;
  todayIsoDate: () => string;
}

export interface TpsBaseWriteTargetHost {
  app: App;
  settings: {
    tpsBaseWriteFallbackMode?: TpsBaseWriteFallbackMode;
    tpsBaseWriteFallbackPath?: string;
  };
  noteOperationService: {
    ensureDailyNote(dateValue: string): Promise<TFile | null>;
  };
}

export function normalizeTpsBaseWriteFallbackMode(value: unknown): TpsBaseWriteFallbackMode {
  return value === 'filter-required' || value === 'specific-note'
    ? value
    : 'today-daily-note';
}

export function normalizeTpsBaseWriteNotePath(value: unknown): string | null {
  let raw = String(value ?? '').trim();
  const markdownLink = raw.match(/^\[[^\]]*\]\(([^)]+)\)$/u);
  if (markdownLink) raw = markdownLink[1] ?? '';
  raw = raw
    .replace(/^\[\[|\]\]$/gu, '')
    .split('|')[0]
    .split('#')[0]
    .replace(/^"+|"+$/gu, '')
    .replace(/^'+|'+$/gu, '')
    .replace(/^\/+/u, '')
    .trim();
  if (!raw) return null;
  const normalized = normalizePath(raw).replace(/^\/+/u, '').trim();
  if (!normalized || normalized.endsWith('/')) return null;
  return /\.[^/]+$/u.test(normalized) ? normalized : `${normalized}.md`;
}

export async function resolveTpsBaseWriteTarget(
  host: TpsBaseWriteTargetHost,
  options: ResolveTpsBaseWriteTargetOptions,
): Promise<TpsBaseWriteTargetResolution> {
  const explicitPath = normalizeTpsBaseWriteNotePath(options.explicitTargetPath);
  const explicitTargetSpecified = options.explicitTargetSpecified === true
    || String(options.explicitTargetPath ?? '').trim().length > 0;

  if (explicitTargetSpecified) {
    if (!explicitPath) {
      return { file: null, source: 'filter', path: null, reason: 'invalid-filter-target' };
    }
    if (!isMarkdownPath(explicitPath)) {
      return { file: null, source: 'filter', path: explicitPath, reason: 'filter-target-not-markdown' };
    }

    const existing = host.app.vault.getAbstractFileByPath(explicitPath);
    if (existing instanceof TFile) {
      return isMarkdownFile(existing)
        ? { file: existing, source: 'filter', path: existing.path, reason: 'resolved' }
        : { file: null, source: 'filter', path: explicitPath, reason: 'filter-target-not-markdown' };
    }
    if (existing) {
      return { file: null, source: 'filter', path: explicitPath, reason: 'filter-target-not-markdown' };
    }
    if (options.createExplicitIfMissing !== true) {
      return { file: null, source: 'filter', path: explicitPath, reason: 'filter-target-not-found' };
    }

    try {
      await ensureFolderPath(host.app, explicitPath);
      const basename = explicitPath.split('/').pop()?.replace(/\.md$/iu, '') || 'Tasks';
      const created = await host.app.vault.create(
        explicitPath,
        `---\ntitle: ${JSON.stringify(basename)}\n---\n`,
      );
      return isMarkdownFile(created)
        ? { file: created, source: 'filter', path: created.path, reason: 'resolved' }
        : { file: null, source: 'filter', path: explicitPath, reason: 'filter-target-not-markdown' };
    } catch (error) {
      const raced = host.app.vault.getAbstractFileByPath(explicitPath);
      if (raced instanceof TFile && isMarkdownFile(raced)) {
        return { file: raced, source: 'filter', path: raced.path, reason: 'resolved' };
      }
      return {
        file: null,
        source: 'filter',
        path: explicitPath,
        reason: 'filter-target-create-failed',
        error,
      };
    }
  }

  const mode = normalizeTpsBaseWriteFallbackMode(host.settings.tpsBaseWriteFallbackMode);
  if (mode === 'filter-required') {
    return { file: null, source: null, path: null, reason: 'filter-required' };
  }

  if (mode === 'specific-note') {
    const fallbackPath = normalizeTpsBaseWriteNotePath(host.settings.tpsBaseWriteFallbackPath);
    if (!fallbackPath) {
      return { file: null, source: 'specific-note', path: null, reason: 'specific-note-not-configured' };
    }
    if (!isMarkdownPath(fallbackPath)) {
      return { file: null, source: 'specific-note', path: fallbackPath, reason: 'specific-note-not-markdown' };
    }
    const fallback = host.app.vault.getAbstractFileByPath(fallbackPath);
    if (!(fallback instanceof TFile)) {
      return {
        file: null,
        source: 'specific-note',
        path: fallbackPath,
        reason: fallback ? 'specific-note-not-markdown' : 'specific-note-not-found',
      };
    }
    return isMarkdownFile(fallback)
      ? { file: fallback, source: 'specific-note', path: fallback.path, reason: 'resolved' }
      : { file: null, source: 'specific-note', path: fallbackPath, reason: 'specific-note-not-markdown' };
  }

  try {
    const isoDate = String(options.todayIsoDate() || '').trim();
    const dailyNote = isoDate
      ? await host.noteOperationService.ensureDailyNote(`${isoDate} 00:00:00`)
      : null;
    return dailyNote instanceof TFile && isMarkdownFile(dailyNote)
      ? { file: dailyNote, source: 'today-daily-note', path: dailyNote.path, reason: 'resolved' }
      : { file: null, source: 'today-daily-note', path: dailyNote?.path ?? null, reason: 'daily-note-unavailable' };
  } catch (error) {
    return {
      file: null,
      source: 'today-daily-note',
      path: null,
      reason: 'daily-note-unavailable',
      error,
    };
  }
}

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

function isMarkdownFile(file: TFile): boolean {
  return String(file.extension || '').toLowerCase() === 'md';
}

async function ensureFolderPath(app: App, filePath: string): Promise<void> {
  const folderPath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  if (!folderPath) return;
  const parts = folderPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) await app.vault.createFolder(current);
  }
}
