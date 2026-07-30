import { Menu, Notice, setIcon } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import type { TimeTrackingPausedSessionState } from '../types';
import type { TimeTrackingSession } from './time-tracking-service';
import * as logger from '../logger';

type StatusBarTimerState =
  | { kind: 'active'; session: TimeTrackingSession; elapsedMs: number }
  | { kind: 'paused'; paused: TimeTrackingPausedSessionState; elapsedMs: number };

export class TimeTrackingStatusBarService {
  private itemEl: HTMLElement | null = null;
  private updateInFlight = false;
  private refreshPending = false;
  private lastRenderKey = '';
  private cachedState: StatusBarTimerState | null = null;

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  setup(): void {
    if (this.itemEl) return;
    this.itemEl = this.plugin.addStatusBarItem();
    this.itemEl.addClass('tps-gcm-time-tracker-status-item');
    this.itemEl.style.display = 'none';

    this.plugin.registerInterval(window.setInterval(() => {
      void this.update(false, false);
    }, 1000));
    this.plugin.registerInterval(window.setInterval(() => {
      void this.update(true, true);
    }, 30000));

    this.plugin.app.workspace.onLayoutReady(() => {
      this.reposition();
      void this.update(true, true);
    });
    this.refresh();
  }

  detach(): void {
    this.itemEl?.remove();
    this.itemEl = null;
    this.refreshPending = false;
    this.lastRenderKey = '';
    this.cachedState = null;
  }

  refresh(): void {
    if (!this.itemEl) return;
    if (this.updateInFlight) {
      this.refreshPending = true;
      return;
    }
    void this.update(true, true);
  }

  private async update(force = false, fetchStatus = true): Promise<void> {
    if (this.updateInFlight || !this.itemEl) return;
    const itemEl = this.itemEl;
    this.updateInFlight = true;
    try {
      const state = fetchStatus
        ? await this.getTimerState()
        : this.refreshCachedElapsed(this.cachedState);
      if (this.itemEl !== itemEl) return;
      this.cachedState = state;
      if (!state) {
        this.lastRenderKey = '';
        itemEl.style.display = 'none';
        itemEl.empty();
        return;
      }

      const renderKey = this.buildRenderKey(state);
      if (!force && renderKey === this.lastRenderKey) {
        this.reposition();
        return;
      }
      this.lastRenderKey = renderKey;
      this.render(state);
      this.reposition();
    } catch (error) {
      logger.warn('[TPS GCM] Failed to refresh time tracking status bar', { error });
    } finally {
      this.updateInFlight = false;
      if (this.refreshPending && this.itemEl) {
        this.refreshPending = false;
        void this.update(true, true);
      } else if (!this.itemEl) {
        this.refreshPending = false;
      }
    }
  }

  private async getTimerState(): Promise<StatusBarTimerState | null> {
    if (this.plugin.settings.enableTimeTracking === false) return null;
    const status = await this.plugin.timeTrackingService.getRuntimeStatus();
    if (status.active) {
      return {
        kind: 'active',
        session: status.active,
        elapsedMs: this.getElapsedMs(status.active.start),
      };
    }
    if (status.paused) {
      return {
        kind: 'paused',
        paused: status.paused,
        elapsedMs: Math.max(0, status.paused.elapsedMs || 0),
      };
    }
    return null;
  }

  private render(state: StatusBarTimerState): void {
    if (!this.itemEl) return;
    this.itemEl.empty();
    this.itemEl.style.display = '';
    this.itemEl.toggleClass('is-paused', state.kind === 'paused');

    const container = this.itemEl.createDiv({ cls: 'tps-gcm-time-tracker-status' });
    container.addEventListener('contextmenu', (evt) => {
      evt.preventDefault();
      this.showContextMenu(evt, state);
    });

    const mainButton = container.createEl('button', {
      cls: 'tps-gcm-time-tracker-main',
      attr: {
        type: 'button',
        'aria-label': state.kind === 'active' ? 'Open active timer target' : 'Open paused timer target',
        title: state.kind === 'active' ? 'Open active timer target' : 'Open paused timer target',
      },
    });
    mainButton.addEventListener('click', async () => {
      let opened = false;
      if (state.kind === 'active') {
        opened = await this.plugin.timeTrackingService.openHydratedSessionTarget(state.session);
      } else {
        opened = await this.plugin.timeTrackingService.openPausedTimerTarget();
      }
      if (!opened) new Notice('Could not open timer target.');
    });

    const iconEl = mainButton.createSpan({ cls: 'tps-gcm-time-tracker-icon' });
    setIcon(iconEl, state.kind === 'active' ? 'timer' : 'timer-off');

    const textEl = mainButton.createSpan({ cls: 'tps-gcm-time-tracker-text' });
    const title = state.kind === 'active' ? state.session.title : state.paused.title;
    textEl.textContent = `${state.kind === 'paused' ? 'Paused ' : ''}${this.formatElapsed(state.elapsedMs)} | ${title || 'Tracked time'}`;

    const toggleButton = container.createEl('button', {
      cls: 'tps-gcm-time-tracker-action',
      attr: {
        type: 'button',
        'aria-label': state.kind === 'active' ? 'Pause timer' : 'Resume timer',
        title: state.kind === 'active' ? 'Pause timer' : 'Resume timer',
      },
    });
    setIcon(toggleButton, state.kind === 'active' ? 'pause' : 'play');
    toggleButton.addEventListener('click', async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const changed = state.kind === 'active'
        ? await this.plugin.timeTrackingService.pauseActiveTimer()
        : await this.plugin.timeTrackingService.resumePausedTimer();
      if (!changed) this.refresh();
    });

    const stopButton = container.createEl('button', {
      cls: 'tps-gcm-time-tracker-action',
      attr: {
        type: 'button',
        'aria-label': 'Stop timer',
        title: 'Stop timer',
      },
    });
    setIcon(stopButton, 'square');
    stopButton.addEventListener('click', async (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const changed = state.kind === 'active'
        ? await this.plugin.timeTrackingService.stopActiveTimer()
        : await this.plugin.timeTrackingService.clearPausedTimer();
      if (!changed) this.refresh();
    });
  }

  private refreshCachedElapsed(state: StatusBarTimerState | null): StatusBarTimerState | null {
    if (!state) return null;
    if (state.kind === 'paused') return state;
    return {
      ...state,
      elapsedMs: this.getElapsedMs(state.session.start),
    };
  }

  private showContextMenu(evt: MouseEvent, state: StatusBarTimerState): void {
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle('Open target')
        .setIcon('arrow-up-right')
        .onClick(async () => {
          if (state.kind === 'active') {
            await this.plugin.timeTrackingService.openSessionTarget(state.session.id);
          } else {
            await this.plugin.timeTrackingService.openPausedTimerTarget();
          }
        });
    });
    menu.addItem((item) => {
      item
        .setTitle(state.kind === 'active' ? 'Pause timer' : 'Resume timer')
        .setIcon(state.kind === 'active' ? 'pause' : 'play')
        .onClick(async () => {
          const changed = state.kind === 'active'
            ? await this.plugin.timeTrackingService.pauseActiveTimer()
            : await this.plugin.timeTrackingService.resumePausedTimer();
          if (!changed) this.refresh();
        });
    });
    menu.addItem((item) => {
      item
        .setTitle('Stop timer')
        .setIcon('square')
        .onClick(async () => {
          const changed = state.kind === 'active'
            ? await this.plugin.timeTrackingService.stopActiveTimer()
            : await this.plugin.timeTrackingService.clearPausedTimer();
          if (!changed) this.refresh();
        });
    });
    menu.showAtMouseEvent(evt);
  }

  private reposition(): void {
    if (!this.itemEl) return;
    const statusBar = this.itemEl.closest('.status-bar') as HTMLElement | null
      ?? document.querySelector('.status-bar');
    if (!statusBar) return;

    const wordCountItem = this.findWordCountItem(statusBar);
    if (wordCountItem && wordCountItem !== this.itemEl && wordCountItem.parentElement === statusBar) {
      statusBar.insertBefore(this.itemEl, wordCountItem);
    }
  }

  private findWordCountItem(statusBar: HTMLElement): HTMLElement | null {
    const classMatch = statusBar.querySelector<HTMLElement>(
      '.status-bar-item.plugin-word-count, .status-bar-item.mod-word-count, .status-bar-item.word-count',
    );
    if (classMatch) return classMatch;

    return Array.from(statusBar.querySelectorAll<HTMLElement>('.status-bar-item')).find((item) => {
      if (item === this.itemEl) return false;
      const text = (item.textContent || '').trim().toLowerCase();
      return /\bwords?\b/.test(text) || /\bcharacters?\b/.test(text);
    }) ?? null;
  }

  private buildRenderKey(state: StatusBarTimerState): string {
    const seconds = Math.floor(state.elapsedMs / 1000);
    if (state.kind === 'active') {
      return `active:${state.session.id}:${seconds}:${state.session.title}`;
    }
    return `paused:${state.paused.targetId}:${seconds}:${state.paused.title}`;
  }

  private getElapsedMs(rawStart: string): number {
    return this.plugin.timeTrackingService.getElapsedMsForSession({ start: rawStart });
  }

  private formatElapsed(ms: number): string {
    return this.plugin.timeTrackingService.formatElapsed(ms);
  }
}
