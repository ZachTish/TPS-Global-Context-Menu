import { moment } from "obsidian";

export const FALLBACK_DAILY_DATE_FORMATS = [
  "YYYY-MM-DD",
  "YYYY_MM_DD",
  "YYYYMMDD",
  "ddd, MMM D YYYY",
  "ddd, MMM DD YYYY",
  "ddd, MMM Do YYYY",
  "ddd MMM D YYYY",
  "dddd, MMMM D YYYY",
  "dddd, MMMM DD YYYY",
  "dddd, MMMM Do YYYY",
  "dddd MMMM D YYYY",
  "MMM D YYYY",
  "MMM Do YYYY",
  "MMMM D YYYY",
  "MMMM Do YYYY",
  "MMM D, YYYY",
  "MMMM D, YYYY",
];

/**
 * Parse a Daily Note date only when the complete filename/path stem is the
 * date. Record filenames may begin with a date, so embedded-date parsing must
 * never be used for Daily Note identity.
 */
export function parseStrictDateFromFilename(filename: string, userFormat?: string) {
  const parseMoment = ((((globalThis as any).window as any)?.moment) || moment) as any;
  const cleaned = filename.trim().replace(/\.md$/i, "");
  const formats = [
    ...(userFormat?.trim() ? [userFormat.trim()] : []),
    ...FALLBACK_DAILY_DATE_FORMATS,
  ];
  return parseMoment(cleaned, formats, true);
}

export function parseDateFromFilename(filename: string, userFormat?: string) {
  const parseMoment = ((((globalThis as any).window as any)?.moment) || moment) as any;
  const cleaned = filename.trim().replace(/\.[^.]+$/, "");
  const formats = [
    ...(userFormat?.trim() ? [userFormat.trim()] : []),
    ...FALLBACK_DAILY_DATE_FORMATS,
  ];

  const strict = parseStrictDateFromFilename(cleaned, userFormat);
  if (strict?.isValid?.() && strict.isValid()) {
    return strict;
  }

  const embeddedDate = cleaned.match(
    /(\d{4}[-_]\d{2}[-_]\d{2}|\d{8}|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i,
  );
  if (embeddedDate) {
    const embedded = parseMoment(embeddedDate[1], formats, true);
    if (embedded?.isValid?.() && embedded.isValid()) {
      return embedded;
    }
  }

  return typeof parseMoment.invalid === "function"
    ? parseMoment.invalid()
    : { isValid: () => false, format: () => "" };
}
