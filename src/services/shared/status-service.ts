import { TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../../main';
import { STATUSES } from '../../constants';
import { findKeyCaseInsensitive, setValueCaseInsensitive, deleteValueCaseInsensitive } from '../../core';
import { setCompletedDateValue } from '../../utils/completed-date-utils';

export type StatusSet = {
  canonical: string[];
  aliases: Record<string, string>;
};

export class SharedStatusService {
  private readonly aliases: Record<string, string> = {
    active: 'todo',
    open: 'todo',
    pending: 'todo',
    incomplete: 'todo',
    doing: 'working',
    'in-progress': 'working',
    inprogress: 'working',
    blocked: 'holding',
    hold: 'holding',
    waiting: 'holding',
    question: 'holding',
    done: 'complete',
    completed: 'complete',
    finished: 'complete',
    canceled: 'wont-do',
    cancelled: 'wont-do',
    skipped: 'wont-do',
    'wont do': 'wont-do',
    wontdo: 'wont-do',
  };

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  getCanonicalStatuses(): string[] {
    return [...STATUSES];
  }

  getStatusSet(): StatusSet {
    return {
      canonical: this.getCanonicalStatuses(),
      aliases: { ...this.aliases },
    };
  }

  normalize(raw: unknown): string {
    const normalized = String(raw ?? '').trim().toLowerCase();
    if (!normalized) return '';
    return this.aliases[normalized] || normalized;
  }

  normalizeRaw(raw: unknown): string {
    return String(raw ?? '').trim().toLowerCase();
  }

  getStatusPropertyKey(): string {
    const configured = (this.plugin.settings.properties || []).find((property) => {
      const id = String(property?.id || '').trim().toLowerCase();
      const key = String(property?.key || '').trim().toLowerCase();
      return id === 'status' || key === 'status';
    });
    return String(configured?.key || 'status').trim() || 'status';
  }

  getStatusOptions(): string[] {
    const key = this.getStatusPropertyKey().toLowerCase();
    const configured = (this.plugin.settings.properties || []).find((property) => {
      const id = String(property?.id || '').trim().toLowerCase();
      const propertyKey = String(property?.key || '').trim().toLowerCase();
      return id === 'status' || propertyKey === key;
    });
    const options = Array.isArray(configured?.options)
      ? configured.options.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    return options.length ? options : this.getCanonicalStatuses();
  }

  getDoneStatuses(): string[] {
    const configured = Array.isArray(this.plugin.settings.recurrenceCompletionStatuses)
      ? this.plugin.settings.recurrenceCompletionStatuses
      : [];
    const raw = configured.length ? configured : ['complete', 'wont-do'];
    return Array.from(new Set(raw.map((status) => this.normalize(status)).filter(Boolean)));
  }

  getActiveStatuses(): string[] {
    const configured = Array.isArray(this.plugin.settings.activeStatusValues)
      ? this.plugin.settings.activeStatusValues
      : [];
    const raw = configured.length ? configured : ['todo', 'working', 'holding'];
    return Array.from(new Set(raw.map((status) => this.normalize(status)).filter(Boolean)));
  }

  isActiveStatus(raw: unknown): boolean {
    const normalized = this.normalize(raw);
    return !!normalized && this.getActiveStatuses().includes(normalized);
  }

  getInactiveStatuses(): string[] {
    const active = new Set(this.getActiveStatuses());
    const options = this.getStatusOptions().map((status) => this.normalize(status)).filter(Boolean);
    const inactive = options.filter((status) => !active.has(status));
    for (const status of this.getDoneStatuses()) {
      if (active.has(status)) continue;
      if (!inactive.includes(status)) inactive.push(status);
    }
    return Array.from(new Set(inactive));
  }

  isDoneStatus(raw: unknown): boolean {
    const normalized = this.normalize(raw);
    return !!normalized && this.getDoneStatuses().includes(normalized);
  }

  getStatuses(frontmatter: Record<string, unknown> | null | undefined, property = this.getStatusPropertyKey()): string[] {
    if (!frontmatter || typeof frontmatter !== 'object') return [];
    const key = findKeyCaseInsensitive(frontmatter, property);
    if (!key) return [];
    const raw = frontmatter[key];
    const values = Array.isArray(raw)
      ? raw
      : String(raw ?? '').includes(',')
        ? String(raw ?? '').split(',')
        : [raw];
    return values.map((value) => this.normalize(value)).filter(Boolean);
  }

  checkboxStateToStatus(rawState: unknown): string {
    let state = String(rawState ?? '').trim();
    if (state.startsWith('[') && state.endsWith(']')) {
      state = state.slice(1, -1);
    }
    const marker = state.trim().toLowerCase();
    if (marker === '' || marker === ' ') return 'todo';
    if (marker === 'x') return 'complete';
    if (marker === '/' || marker === '\\') return 'working';
    if (marker === '?') return 'holding';
    if (marker === '-' || marker === '~') return 'wont-do';
    return this.normalize(marker);
  }

  statusToCheckboxState(rawStatus: unknown): string {
    const normalized = this.normalize(rawStatus);
    if (normalized === 'complete') return 'x';
    if (normalized === 'working') return '/';
    if (normalized === 'holding') return '?';
    if (normalized === 'wont-do') return '-';
    return ' ';
  }

  async setFileStatus(file: TFile, status: string | null): Promise<boolean> {
    const statusKey = this.getStatusPropertyKey();
    const normalized = status == null ? null : this.normalize(status);
    const completedDateKey = 'completedDate';

    const changed = await this.plugin.frontmatterMutationService.process(file, (frontmatter) => {
      if (normalized == null || normalized === '') {
        deleteValueCaseInsensitive(frontmatter, statusKey);
        deleteValueCaseInsensitive(frontmatter, completedDateKey);
        return;
      }

      setValueCaseInsensitive(frontmatter, statusKey, normalized);
      if (this.isDoneStatus(normalized)) {
        setCompletedDateValue(frontmatter);
      } else {
        deleteValueCaseInsensitive(frontmatter, completedDateKey);
      }
    });

    if (changed) {
      this.plugin.eventService.emitFilesUpdated([file.path]);
    }
    return changed;
  }
}
