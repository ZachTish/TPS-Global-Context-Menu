/**
 * Centralized logging for TPS Kanban.
 * Debug/info/warn output is gated by settings; errors always pass through.
 */
const PLUGIN_PREFIX = "[TPS Kanban]";

type LogLevel = "debug" | "info" | "warn" | "error";

let loggingEnabled = false;
const recentMessages = new Map<string, number>();
const DEDUP_WINDOW_MS = 3000;

export function setLoggingEnabled(value: boolean): void {
  loggingEnabled = !!value;
  if (value) {
    console.log(`${PLUGIN_PREFIX} [Logger] Debug logging enabled - ${new Date().toISOString()}`);
  }
}

function shouldLog(level: LogLevel, message: string, params: unknown[]): boolean {
  const tail = params.map(stableParam).join("|");
  const key = `${level}:${message}:${tail}`;
  const now = Date.now();
  const last = recentMessages.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return false;
  recentMessages.set(key, now);
  if (recentMessages.size > 300) {
    for (const [entryKey, timestamp] of recentMessages.entries()) {
      if (now - timestamp > DEDUP_WINDOW_MS) recentMessages.delete(entryKey);
    }
  }
  return true;
}

function stableParam(value: unknown): string {
  if (value instanceof Error) return `${value.name}:${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toMessage(message: unknown): string {
  return typeof message === "string" ? message : String(message ?? "");
}

function emit(level: LogLevel, message?: unknown, ...rest: unknown[]): void {
  if (level !== "error" && !loggingEnabled) return;
  const msg = toMessage(message);
  if (!shouldLog(level, msg, rest)) return;
  const args = [`${PLUGIN_PREFIX} ${msg}`, ...rest];
  if (level === "error") console.error(...args);
  else if (level === "warn") console.warn(...args);
  else if (level === "debug") console.debug(...args);
  else console.log(...args);
}

export function debug(message?: unknown, ...rest: unknown[]): void {
  emit("debug", message, ...rest);
}

export function info(message?: unknown, ...rest: unknown[]): void {
  emit("info", message, ...rest);
}

export const log = info;

export function warn(message?: unknown, ...rest: unknown[]): void {
  emit("warn", message, ...rest);
}

export function error(message?: unknown, ...rest: unknown[]): void {
  emit("error", message, ...rest);
}

export function flow(scope: string, event: string, data?: Record<string, unknown>): void {
  info(`[${scope}] ${event}`, data || {});
}

export function flowWarn(scope: string, event: string, data?: Record<string, unknown>): void {
  warn(`[${scope}] ${event}`, data || {});
}

export function flowError(scope: string, event: string, err: unknown, data?: Record<string, unknown>): void {
  error(`[${scope}] ${event}`, { ...(data || {}), error: errorSummary(err) });
}

export function errorSummary(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  return stableParam(err);
}
