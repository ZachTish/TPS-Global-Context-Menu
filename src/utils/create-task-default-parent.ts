import type { CreateTaskDefaultParentMode } from '../types';

export function normalizeCreateTaskDefaultParentMode(value: unknown): CreateTaskDefaultParentMode {
  return value === 'today-daily-note' ? 'today-daily-note' : 'standalone';
}
