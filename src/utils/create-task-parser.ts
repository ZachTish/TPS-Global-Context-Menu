import * as chrono from 'chrono-node';

export interface ParsedCreateTaskInput {
  rawInput: string;
  title: string;
  detectedDateText: string;
  detectedDateStart: number;
  detectedDateEnd: number;
  scheduledValue: string;
  allDay: boolean;
}

export function parseCreateTaskInput(input: string, referenceDate = new Date()): ParsedCreateTaskInput {
  const rawInput = String(input || '');
  const result = chrono.casual.parse(rawInput, referenceDate, { forwardDate: true })[0];
  if (!result) {
    return {
      rawInput,
      title: normalizeTaskTitle(rawInput),
      detectedDateText: '',
      detectedDateStart: -1,
      detectedDateEnd: -1,
      scheduledValue: '',
      allDay: false,
    };
  }

  const detectedDateText = String(result.text || '');
  const detectedDateStart = Math.max(0, Number(result.index || 0));
  const detectedDateEnd = detectedDateStart + detectedDateText.length;
  const title = normalizeTaskTitle(`${rawInput.slice(0, detectedDateStart)} ${rawInput.slice(detectedDateEnd)}`);
  const date = result.start.date();
  const hasTime = result.start.isCertain('hour') || result.start.isCertain('minute');

  return {
    rawInput,
    title,
    detectedDateText,
    detectedDateStart,
    detectedDateEnd,
    scheduledValue: hasTime ? formatInlineDateTime(date) : formatInlineDate(date),
    allDay: !hasTime,
  };
}

export function buildCreatedTaskLine(options: {
  title: string;
  checkboxMarker?: string;
  scheduledValue?: string;
  allDay?: boolean;
  timeEstimate?: number;
  priority?: string;
}): string {
  const marker = normalizeCheckboxMarker(options.checkboxMarker);
  const title = normalizeTaskTitle(options.title);
  const parts = [`- [${marker}] ${title || 'Untitled task'}`];
  const priority = String(options.priority || '').trim();
  const scheduledValue = String(options.scheduledValue || '').trim();
  const timeEstimate = Math.max(0, Math.round(Number(options.timeEstimate || 0)));
  if (priority) parts.push(`[priority:: ${priority}]`);
  if (scheduledValue) parts.push(`[scheduled:: ${scheduledValue}]`);
  if (scheduledValue && !options.allDay && timeEstimate > 0) parts.push(`[timeEstimate:: ${timeEstimate}]`);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function formatInlineDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

export function formatInlineDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeTaskTitle(input: string): string {
  return String(input || '')
    .replace(/\s+([#@])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCheckboxMarker(value: string | undefined): string {
  const marker = String(value ?? ' ').trim();
  if (!marker) return ' ';
  if (marker.length === 1) return marker;
  const tokenMatch = marker.match(/^\[([^\]\r\n]?)\]$/);
  if (tokenMatch) return tokenMatch[1] || ' ';
  return marker.slice(0, 1);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
