import { App, TFile, moment, normalizePath } from 'obsidian';
import { parseDateFromFilename } from './daily-file-date';
import { readInlineFieldValue } from './task-line-metadata';

type FileLike = {
  path: string;
  basename: string;
};

export function dailyNoteTaskScheduleInheritanceEnabled(settings: unknown): boolean {
  return (settings as { inheritUnscheduledTasksFromDailyNotes?: boolean } | null | undefined)
    ?.inheritUnscheduledTasksFromDailyNotes !== false;
}

export function getDailyNoteFolder(app: App): string {
  try {
    const folder = String((app as any).internalPlugins?.plugins?.['daily-notes']?.instance?.options?.folder || '').trim();
    if (folder) return folder;
  } catch {
    // Fall through to the historical plugin default.
  }
  return 'System/Dailynotes';
}

export function getDailyNoteDateFormat(app: App, settings: unknown): string {
  const configured = String((settings as { dailyNoteDateFormat?: string } | null | undefined)?.dailyNoteDateFormat || '').trim();
  if (configured) return configured;
  const dailyNotesFormat = String((app as any).internalPlugins?.plugins?.['daily-notes']?.instance?.options?.format || '').trim();
  return dailyNotesFormat || 'YYYY-MM-DD';
}

export function parseDailyNoteFileDate(app: App, settings: unknown, file: FileLike): string | null {
  if (!isFileInDailyNoteFolder(app, file)) return null;
  const parsed = parseDateFromFilename(file.basename, getDailyNoteDateFormat(app, settings));
  return parsed?.isValid?.() && parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}

export function findExistingDailyNoteForIsoDate(app: App, settings: unknown, isoDate: string): TFile | null {
  const wanted = String(isoDate || '').trim();
  if (!wanted) return null;

  const canonicalPath = getDailyNotePathForIsoDate(app, settings, wanted);
  const canonical = app.vault.getAbstractFileByPath(canonicalPath);
  if (canonical instanceof TFile) return canonical;

  const candidates = app.vault.getMarkdownFiles()
    .filter((file) => parseDailyNoteFileDate(app, settings, file) === wanted)
    .sort((a, b) => {
      const aPath = normalizePath(a.path);
      const bPath = normalizePath(b.path);
      return aPath.localeCompare(bPath);
    });

  return candidates[0] ?? null;
}

export function getDailyNoteScheduledValueForIsoDate(isoDate: string): string {
  return `${String(isoDate || '').trim()} 00:00:00`;
}

export function getInheritedDailyNoteTaskScheduledValue(app: App, settings: unknown, file: FileLike): string | null {
  if (!dailyNoteTaskScheduleInheritanceEnabled(settings)) return null;
  return parseDailyNoteFileDate(app, settings, file);
}

export function resolveTaskScheduledValue(app: App, settings: unknown, file: FileLike, rawLine: string): string {
  const explicit = readInlineFieldValue(rawLine, 'scheduled')
    || readInlineFieldValue(rawLine, 'start')
    || readInlineFieldValue(rawLine, 'date');
  if (explicit) return explicit;
  return getInheritedDailyNoteTaskScheduledValue(app, settings, file) || '';
}

export function getIsoDateFromScheduledValue(value: string): string | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const momentLib = ((window as any)?.moment || moment) as any;
  const parsed = momentLib(text, [
    momentLib.ISO_8601,
    'YYYY-MM-DD',
    'YYYY-MM-DD HH:mm',
    'YYYY-MM-DD HH:mm:ss',
    'YYYY-MM-DDTHH:mm',
    'YYYY-MM-DDTHH:mm:ss',
  ], true);
  if (parsed?.isValid?.() && parsed.isValid()) return parsed.format('YYYY-MM-DD');
  const fallback = momentLib(text);
  return fallback?.isValid?.() && fallback.isValid() ? fallback.format('YYYY-MM-DD') : null;
}

export function getDailyNotePathForIsoDate(app: App, settings: unknown, isoDate: string): string {
  const momentLib = ((window as any)?.moment || moment) as any;
  const parsed = momentLib(isoDate, 'YYYY-MM-DD', true);
  const basename = parsed?.isValid?.() && parsed.isValid()
    ? parsed.format(getDailyNoteDateFormat(app, settings))
    : isoDate;
  const folder = normalizeDailyFolder(getDailyNoteFolder(app));
  return normalizePath(folder ? `${folder}/${basename}.md` : `${basename}.md`);
}

function isFileInDailyNoteFolder(app: App, file: FileLike): boolean {
  const folder = normalizeDailyFolder(getDailyNoteFolder(app));
  if (!folder) return !String(file.path || '').includes('/');
  return String(file.path || '') === `${folder}/${file.basename}.md`;
}

export function normalizeDailyFolder(folder: string): string {
  const normalized = normalizePath(String(folder || '').trim());
  return normalized === '/' ? '' : normalized.replace(/^\/+|\/+$/g, '');
}
