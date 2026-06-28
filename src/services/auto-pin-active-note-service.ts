import { Component, MarkdownView, Notice, TFile, WorkspaceLeaf, debounce } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';

type MatchReason =
  | { kind: 'scheduled'; endsAt: number }
  | { kind: 'frontmatter-rule'; key: string; value: string }
  | { kind: 'time-tracking'; count: number };

interface PinRule {
  key: string;
  value: string;
}

export class AutoPinActiveNoteService extends Component {
  private readonly leafIds = new WeakMap<WorkspaceLeaf, string>();
  private nextLeafId = 1;
  private readonly autoPinnedLeafIdsByPath = new Map<string, Set<string>>();
  private readonly activeReasonsByPath = new Map<string, MatchReason>();
  private readonly debouncedEvaluateFile = debounce((file: TFile) => {
    void this.evaluateFile(file);
  }, 250, false);

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {
    super();
  }

  onload(): void {
    this.registerEvent(this.plugin.app.metadataCache.on('changed', (file) => {
      if (file instanceof TFile && file.extension?.toLowerCase() === 'md') {
        this.debouncedEvaluateFile(file);
      }
    }));

    this.registerEvent(this.plugin.app.workspace.on('layout-change', () => {
      void this.evaluateAllOpenManagedFiles();
    }));

    this.registerInterval(window.setInterval(() => {
      void this.evaluateAllFiles();
    }, 30_000));

    this.plugin.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => void this.evaluateAllFiles(), 1500);
    });
  }

  onunload(): void {
    for (const path of Array.from(this.autoPinnedLeafIdsByPath.keys())) {
      this.releasePath(path);
    }
    this.autoPinnedLeafIdsByPath.clear();
    this.activeReasonsByPath.clear();
  }

  async evaluateAllFiles(): Promise<void> {
    if (!this.isEnabled() || !this.hasActiveCriteria()) {
      for (const path of Array.from(this.autoPinnedLeafIdsByPath.keys())) {
        this.releasePath(path);
      }
      this.activeReasonsByPath.clear();
      return;
    }

    const activeTimerPaths = await this.getActiveTimerPathSet();
    const stillActive = new Set<string>();
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      const active = await this.evaluateFile(file, activeTimerPaths);
      if (active) stillActive.add(file.path);
    }

    for (const path of Array.from(this.autoPinnedLeafIdsByPath.keys())) {
      if (!stillActive.has(path)) this.releasePath(path);
    }
  }

  private async evaluateAllOpenManagedFiles(): Promise<void> {
    const paths = new Set<string>(this.autoPinnedLeafIdsByPath.keys());
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file instanceof TFile) {
        paths.add(view.file.path);
      }
    }
    for (const path of paths) {
      const file = this.plugin.app.vault.getFileByPath(path);
      if (file) {
        await this.evaluateFile(file);
      } else {
        this.releasePath(path);
      }
    }
  }

  private async evaluateFile(file: TFile, activeTimerPaths?: Set<string>): Promise<boolean> {
    if (!this.isEnabled()) {
      this.releasePath(file.path);
      return false;
    }

    const reason = await this.getActiveReason(file, activeTimerPaths);
    if (!reason) {
      this.activeReasonsByPath.delete(file.path);
      this.releasePath(file.path);
      return false;
    }

    this.activeReasonsByPath.set(file.path, reason);
    await this.ensureOpenAndPinned(file);
    return true;
  }

  private isEnabled(): boolean {
    return this.plugin.settings.enableAutoPinActiveNotes === true;
  }

  private hasActiveCriteria(): boolean {
    if (this.plugin.timeTrackingService?.isEnabled?.() === true) return true;
    if (this.plugin.settings.autoPinActiveScheduledNotes !== false) return true;
    return this.getFrontmatterRules().length > 0;
  }

  private async getActiveReason(file: TFile, activeTimerPaths?: Set<string>): Promise<MatchReason | null> {
    const activeTimerCount = activeTimerPaths
      ? activeTimerPaths.has(file.path) ? 1 : 0
      : this.plugin.timeTrackingService?.getActiveTimerCountForFileSync?.(file) ?? 0;
    if (activeTimerCount > 0) return { kind: 'time-tracking', count: activeTimerCount };

    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    if (!frontmatter || typeof frontmatter !== 'object') return null;

    const rule = this.getMatchingFrontmatterRule(frontmatter);
    if (rule) return { kind: 'frontmatter-rule', key: rule.key, value: rule.value };

    if (this.plugin.settings.autoPinActiveScheduledNotes !== false) {
      const scheduled = this.getValueCaseInsensitive(frontmatter, 'scheduled');
      const scheduledStart = this.parseDateMillis(scheduled);
      if (scheduledStart != null) {
        const durationMinutes = this.getDurationMinutes(frontmatter);
        const endsAt = scheduledStart + durationMinutes * 60_000;
        const now = Date.now();
        if (scheduledStart <= now && now < endsAt) {
          return { kind: 'scheduled', endsAt };
        }
      }
    }

    return null;
  }

  private getMatchingFrontmatterRule(frontmatter: Record<string, unknown>): PinRule | null {
    for (const rule of this.getFrontmatterRules()) {
      const value = this.getValueCaseInsensitive(frontmatter, rule.key);
      if (this.valueMatches(value, rule.value)) return rule;
    }
    return null;
  }

  private getFrontmatterRules(): PinRule[] {
    return String(this.plugin.settings.autoPinFrontmatterRules || '')
      .split(/\r?\n|,/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): PinRule | null => {
        const separator = line.includes('=') ? '=' : line.includes(':') ? ':' : '';
        if (!separator) return null;
        const [rawKey, ...rest] = line.split(separator);
        const key = rawKey.trim();
        const value = rest.join(separator).trim();
        return key && value ? { key, value } : null;
      })
      .filter((rule): rule is PinRule => rule !== null);
  }

  private async ensureOpenAndPinned(file: TFile): Promise<void> {
    const existing = this.findMarkdownLeafForFile(file);
    let leaf = existing ?? this.plugin.app.workspace.getLeaf('tab');
    if (!leaf) return;

    const wasPinned = this.isLeafPinned(leaf);
    if (!existing) {
      const opened = await this.plugin.openFileInLeaf(file, false, () => leaf, {
        active: false,
        revealLeaf: true,
      });
      if (!opened) return;
      leaf = this.findMarkdownLeafForFile(file) ?? leaf;
      const reason = this.activeReasonsByPath.get(file.path);
      new Notice(`Reopened pinned note "${file.basename}" because ${this.describeReason(reason)}.`);
    }

    if (!this.isLeafPinned(leaf)) {
      leaf.setPinned(true);
    }

    if (!wasPinned) {
      const id = this.getLeafId(leaf);
      if (!this.autoPinnedLeafIdsByPath.has(file.path)) {
        this.autoPinnedLeafIdsByPath.set(file.path, new Set());
      }
      this.autoPinnedLeafIdsByPath.get(file.path)?.add(id);
      logger.log('[TPS GCM] Auto-pinned active note', {
        path: file.path,
        reason: this.activeReasonsByPath.get(file.path)?.kind ?? 'unknown',
      });
    }
  }

  private async getActiveTimerPathSet(): Promise<Set<string>> {
    const paths = new Set<string>();
    if (this.plugin.timeTrackingService?.isEnabled?.() !== true) return paths;
    const timers = await this.plugin.timeTrackingService.getActiveTimers();
    for (const timer of timers) {
      if (timer.targetType !== 'note') continue;
      const targetPath = String(timer.targetPath || timer.sourcePath || '').trim();
      if (targetPath) paths.add(targetPath);
    }
    return paths;
  }

  private describeReason(reason: MatchReason | undefined): string {
    if (!reason) return 'it matches an active auto-pin rule';
    if (reason.kind === 'time-tracking') return 'it has an active note-level time tracking session';
    if (reason.kind === 'scheduled') return 'its note-level scheduled time is active';
    return `its note-level ${reason.key} value matches ${reason.value}`;
  }

  private releasePath(path: string): void {
    const ids = this.autoPinnedLeafIdsByPath.get(path);
    if (!ids || ids.size === 0) return;

    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      if (!ids.has(this.getLeafId(leaf))) continue;
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.file?.path !== path) continue;
      if (this.isLeafPinned(leaf)) {
        leaf.setPinned(false);
      }
    }

    this.autoPinnedLeafIdsByPath.delete(path);
    logger.log('[TPS GCM] Released auto-pinned note', { path });
  }

  private findMarkdownLeafForFile(file: TFile): WorkspaceLeaf | null {
    for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === file.path) return leaf;
    }
    return null;
  }

  private isLeafPinned(leaf: WorkspaceLeaf): boolean {
    const state = leaf.getViewState?.();
    const viewStatePinned = Boolean((state?.state as Record<string, unknown> | undefined)?.pinned);
    const ephemeralPinned = Boolean(leaf.getEphemeralState?.()?.pinned);
    const runtimePinned = Boolean((leaf as unknown as { pinned?: boolean }).pinned);
    return viewStatePinned || ephemeralPinned || runtimePinned;
  }

  private getLeafId(leaf: WorkspaceLeaf): string {
    const runtimeId = String((leaf as unknown as { id?: string }).id || '').trim();
    if (runtimeId) return runtimeId;
    let generated = this.leafIds.get(leaf);
    if (!generated) {
      generated = `auto-pin-leaf-${this.nextLeafId++}`;
      this.leafIds.set(leaf, generated);
    }
    return generated;
  }

  private getDurationMinutes(frontmatter: Record<string, unknown>): number {
    const explicitEnd = this.parseDateMillis(
      this.getValueCaseInsensitive(frontmatter, 'end')
        ?? this.getValueCaseInsensitive(frontmatter, 'endDate')
        ?? this.getValueCaseInsensitive(frontmatter, 'ends'),
    );
    const scheduledStart = this.parseDateMillis(this.getValueCaseInsensitive(frontmatter, 'scheduled'));
    if (explicitEnd != null && scheduledStart != null && explicitEnd > scheduledStart) {
      return Math.max(1, Math.round((explicitEnd - scheduledStart) / 60_000));
    }

    const rawDuration =
      this.getValueCaseInsensitive(frontmatter, 'timeEstimate')
      ?? this.getValueCaseInsensitive(frontmatter, 'duration')
      ?? this.getValueCaseInsensitive(frontmatter, 'durationMinutes');
    const parsedDuration = this.parseDurationMinutes(rawDuration);
    if (parsedDuration != null) return parsedDuration;

    const fallback = Number(this.plugin.settings.autoPinScheduledDefaultMinutes);
    return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : 30;
  }

  private parseDurationMinutes(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const hms = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (hms) {
      const hours = Number(hms[1]);
      const minutes = Number(hms[2]);
      return Math.max(1, hours * 60 + minutes);
    }
    const numeric = Number(raw.replace(/[^\d.]/g, ''));
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : null;
  }

  private parseDateMillis(value: unknown): number | null {
    const schedule = this.plugin.sharedServices?.schedule;
    const fromShared = schedule?.parseDateMillis?.(value);
    if (typeof fromShared === 'number' && Number.isFinite(fromShared)) return fromShared;

    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const normalized = /^\d{4}-\d{2}-\d{2} /.test(raw) ? raw.replace(' ', 'T') : raw;
    const parsed = new Date(normalized).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  private getValueCaseInsensitive(frontmatter: Record<string, unknown>, key: string): unknown {
    const lower = key.toLowerCase();
    const match = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === lower);
    return match ? frontmatter[match] : undefined;
  }

  private valueMatches(value: unknown, expected: string): boolean {
    const normalizedExpected = expected.trim().toLowerCase();
    if (Array.isArray(value)) {
      return value.some((item) => this.valueMatches(item, expected));
    }
    return String(value ?? '').trim().toLowerCase() === normalizedExpected;
  }
}
