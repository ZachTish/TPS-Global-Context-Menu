export interface DailyNoteTemplateMoment {
    format(pattern: string): string;
}

export interface DailyNoteTemplateFormats {
    dateFormat?: string;
    timeFormat?: string;
}

/**
 * Keep a Daily Note template/user title authoritative. The filename-derived
 * title exists only as a fallback for templates that do not define one.
 */
export function ensureDailyNoteTitleFallback(
    frontmatter: Record<string, any>,
    fallbackTitle: string,
): boolean {
    const titleKeys = Object.keys(frontmatter).filter(
        (key) => key.trim().toLowerCase() === 'title',
    );
    const meaningfulTitle = titleKeys.find(
        (key) => String(frontmatter[key] ?? '').trim().length > 0,
    );
    if (meaningfulTitle) return false;

    const targetKey = titleKeys[0] || 'title';
    frontmatter[targetKey] = fallbackTitle;
    return true;
}

/**
 * Apply the variables owned by Obsidian's core Templates/Daily Notes flow.
 * Templater expressions are intentionally left intact for Templater itself.
 */
export function applyCoreDailyNoteTemplateVariables(
    content: string,
    targetDate: DailyNoteTemplateMoment,
    title: string,
    currentTime: DailyNoteTemplateMoment = targetDate,
    formats: DailyNoteTemplateFormats = {},
): string {
    const defaultDateFormat = String(formats.dateFormat || '').trim() || 'YYYY-MM-DD';
    const defaultTimeFormat = String(formats.timeFormat || '').trim() || 'HH:mm';
    return String(content ?? '')
        .replace(/\{\{date:([^}]+)\}\}/g, (_match, format) => targetDate.format(String(format).trim()))
        .replace(/\{\{time:([^}]+)\}\}/g, (_match, format) => currentTime.format(String(format).trim()))
        .replace(/\{\{date\}\}/g, targetDate.format(defaultDateFormat))
        .replace(/\{\{time\}\}/g, currentTime.format(defaultTimeFormat))
        .replace(/\{\{title\}\}/g, title);
}

/**
 * Return the complete relative date portion of a Daily Note path. This keeps
 * slash-containing date formats (for example YYYY/MM/DD) distinguishable from
 * ordinary files whose basename happens to be a day number.
 */
export function getDailyNotePathDateCandidate(filePath: string, folder: string): string | null {
    const normalizedPath = String(filePath || '')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\/+/, '')
        .replace(/\.md$/i, '');
    const normalizedFolder = String(folder || '')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\/+|\/+$/g, '');
    if (!normalizedPath) return null;
    if (!normalizedFolder) return normalizedPath;
    const prefix = `${normalizedFolder}/`;
    return normalizedPath.startsWith(prefix)
        ? normalizedPath.slice(prefix.length)
        : null;
}
