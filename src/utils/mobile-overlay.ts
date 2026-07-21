export type VisibleViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type OverlayPlacementOptions = {
  margin?: number;
  gap?: number;
  maxWidth?: number;
  maxHeight?: number;
  compactBreakpoint?: number;
  compactBottomSheet?: boolean;
};

export type OverlayPlacement = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  compact: boolean;
};

const REPOSITION_DELAYS = [0, 80, 220, 420];

function positiveDimension(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function viewportOffset(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function getVisibleViewport(targetWindow: Window = window): VisibleViewport {
  const viewport = targetWindow.visualViewport;
  const layoutWidth = positiveDimension(targetWindow.innerWidth);
  const layoutHeight = positiveDimension(targetWindow.innerHeight);
  if (!viewport) {
    return {
      left: 0,
      top: 0,
      width: layoutWidth ?? 1,
      height: layoutHeight ?? 1,
    };
  }

  const left = viewportOffset(viewport.offsetLeft);
  const top = viewportOffset(viewport.offsetTop);
  const visualWidth = positiveDimension(viewport.width) ?? layoutWidth ?? 1;
  const visualHeight = positiveDimension(viewport.height) ?? layoutHeight ?? 1;
  const right = Math.min(left + visualWidth, layoutWidth ?? left + visualWidth);
  const bottom = Math.min(top + visualHeight, layoutHeight ?? top + visualHeight);
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

export function computeOverlayPlacement(
  viewport: VisibleViewport,
  anchor: Pick<DOMRect, 'left' | 'top' | 'bottom'>,
  measuredHeight: number,
  options: OverlayPlacementOptions = {},
  forceCompact = false,
): OverlayPlacement {
  const margin = options.margin ?? 12;
  const gap = options.gap ?? 8;
  const availableWidth = Math.max(1, viewport.width - margin * 2);
  const availableHeight = Math.max(1, viewport.height - margin * 2);
  const width = Math.min(options.maxWidth ?? 480, availableWidth);
  const maxHeight = Math.min(options.maxHeight ?? availableHeight, availableHeight);
  const height = Math.min(Math.max(1, measuredHeight), maxHeight);
  const compact = forceCompact || viewport.width <= (options.compactBreakpoint ?? 600);

  if (compact && options.compactBottomSheet !== false) {
    return {
      left: viewport.left + margin,
      top: Math.max(viewport.top + margin, viewport.top + viewport.height - height - margin),
      width,
      maxHeight,
      compact,
    };
  }

  const viewportBottom = viewport.top + viewport.height;
  const below = anchor.bottom + gap;
  const top = below + height <= viewportBottom - margin
    ? below
    : Math.max(viewport.top + margin, anchor.top - height - gap);
  const left = Math.max(
    viewport.left + margin,
    Math.min(anchor.left, viewport.left + viewport.width - width - margin),
  );
  return { left, top, width, maxHeight, compact };
}

export class KeyboardAwareOverlay {
  private readonly timers = new Set<number>();
  private readonly repositionHandler = () => this.reposition();
  private readonly focusHandler = () => this.schedule();

  constructor(
    private readonly element: HTMLElement,
    private readonly anchor: HTMLElement,
    private readonly options: OverlayPlacementOptions = {},
  ) {}

  connect(): void {
    this.element.classList.add('tps-keyboard-aware-overlay');
    window.visualViewport?.addEventListener('resize', this.repositionHandler);
    window.visualViewport?.addEventListener('scroll', this.repositionHandler);
    window.addEventListener('resize', this.repositionHandler);
    this.element.addEventListener('focusin', this.focusHandler);
    this.element.addEventListener('focusout', this.focusHandler);
    this.reposition();
  }

  schedule(): void {
    this.clearTimers();
    for (const delay of REPOSITION_DELAYS) {
      this.timers.add(window.setTimeout(() => {
        this.reposition();
      }, delay));
    }
  }

  reposition(): void {
    if (!this.element.isConnected) return;
    const viewport = getVisibleViewport();
    const forceCompact = document.body.classList.contains('is-mobile')
      || document.body.classList.contains('is-phone');
    const compactBottomSheet = forceCompact && this.options.compactBottomSheet !== false;
    if (!this.anchor.isConnected && !compactBottomSheet) return;
    const anchorRect = this.anchor.isConnected
      ? this.anchor.getBoundingClientRect()
      : { left: viewport.left, top: viewport.top, bottom: viewport.top };
    const availableHeight = Math.max(1, viewport.height - (this.options.margin ?? 12) * 2);
    const measuredHeight = Math.min(
      this.element.scrollHeight || this.element.getBoundingClientRect().height || 260,
      availableHeight,
    );
    const placement = computeOverlayPlacement(
      viewport,
      anchorRect,
      measuredHeight,
      this.options,
      forceCompact,
    );
    this.element.classList.toggle('tps-keyboard-aware-overlay--compact', placement.compact);
    this.element.style.setProperty('--tps-overlay-left', `${placement.left}px`);
    this.element.style.setProperty('--tps-overlay-top', `${placement.top}px`);
    this.element.style.setProperty('--tps-overlay-width', `${placement.width}px`);
    this.element.style.setProperty('--tps-overlay-max-height', `${placement.maxHeight}px`);
  }

  disconnect(): void {
    this.clearTimers();
    window.visualViewport?.removeEventListener('resize', this.repositionHandler);
    window.visualViewport?.removeEventListener('scroll', this.repositionHandler);
    window.removeEventListener('resize', this.repositionHandler);
    this.element.removeEventListener('focusin', this.focusHandler);
    this.element.removeEventListener('focusout', this.focusHandler);
  }

  private clearTimers(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
  }
}

export function installVisibleViewportContract(): () => void {
  let timers: number[] = [];
  let baselineHeight = Math.max(window.innerHeight, window.visualViewport?.height ?? 0);

  const update = (): void => {
    const viewport = getVisibleViewport();
    baselineHeight = Math.max(baselineHeight, viewport.height);
    const keyboardInset = Math.max(0, baselineHeight - viewport.height);
    const root = document.documentElement.style;
    root.setProperty('--tps-visible-viewport-left', `${viewport.left}px`);
    root.setProperty('--tps-visible-viewport-top', `${viewport.top}px`);
    root.setProperty('--tps-visible-viewport-width', `${viewport.width}px`);
    root.setProperty('--tps-visible-viewport-height', `${viewport.height}px`);
    root.setProperty('--tps-visible-keyboard-inset', `${keyboardInset}px`);
  };
  const schedule = (): void => {
    for (const timer of timers) window.clearTimeout(timer);
    timers = REPOSITION_DELAYS.map((delay) => window.setTimeout(update, delay));
  };
  const handleFocus = (event: Event): void => {
    schedule();
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const surface = target.closest('.modal:is(.mod-tps-gcm, .tps-keyboard-aware-modal), .tps-keyboard-aware-overlay');
    if (!surface) return;
    for (const delay of [80, 240, 420]) {
      timers.push(window.setTimeout(() => {
        if (target.isConnected && surface.contains(target)) {
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
      }, delay));
    }
  };

  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('focusin', handleFocus, true);
  document.addEventListener('focusout', schedule, true);
  update();

  return () => {
    for (const timer of timers) window.clearTimeout(timer);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('focusin', handleFocus, true);
    document.removeEventListener('focusout', schedule, true);
    const root = document.documentElement.style;
    for (const name of [
      '--tps-visible-viewport-left',
      '--tps-visible-viewport-top',
      '--tps-visible-viewport-width',
      '--tps-visible-viewport-height',
      '--tps-visible-keyboard-inset',
    ]) root.removeProperty(name);
  };
}
