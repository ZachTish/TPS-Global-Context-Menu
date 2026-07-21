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

export type NativeKeyboardState = {
  height: number;
  baselineHeight: number | null;
  baselineWidth: number | null;
};

const REPOSITION_DELAYS = [0, 80, 220, 420];
const NATIVE_KEYBOARD_SHOW_EVENTS = ['keyboardWillShow', 'keyboardDidShow'] as const;
const sharedNativeKeyboard: NativeKeyboardState = {
  height: 0,
  baselineHeight: null,
  baselineWidth: null,
};

function positiveDimension(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeDimension(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function viewportOffset(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function getViewportIntersection(targetWindow: Window): VisibleViewport {
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

export function readNativeKeyboardHeight(event: Event): number | null {
  const direct = nonNegativeDimension((event as Event & { keyboardHeight?: unknown }).keyboardHeight);
  const detail = nonNegativeDimension((event as CustomEvent<{ keyboardHeight?: unknown }>).detail?.keyboardHeight);
  return direct ?? detail;
}

export function applyNativeKeyboardShow(
  state: NativeKeyboardState,
  event: Event,
  targetWindow: Window = window,
): boolean {
  const height = readNativeKeyboardHeight(event);
  if (height === null) return false;
  state.height = height;
  if (height === 0) return true;
  if (state.baselineHeight === null || state.baselineWidth === null) return false;
  seedNativeKeyboardBaseline(state, targetWindow);
  return true;
}

export function clearNativeKeyboard(state: NativeKeyboardState): void {
  state.height = 0;
}

export function resetNativeKeyboard(state: NativeKeyboardState): void {
  state.height = 0;
  state.baselineHeight = null;
  state.baselineWidth = null;
}

function dimensionsApproximatelyMatch(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(2, Math.min(left, right) * 0.08);
}

export function seedNativeKeyboardBaseline(
  state: NativeKeyboardState,
  targetWindow: Window = window,
): VisibleViewport {
  const viewport = getViewportIntersection(targetWindow);
  const widthChanged = state.baselineWidth === null
    || Math.abs(state.baselineWidth - viewport.width) > 1;
  if (state.height > 0) {
    // Without a hidden-state baseline, a shrunken WebView is indistinguishable
    // from a full-height one. Keep the raw viewport instead of double-clamping.
    if (state.baselineHeight === null || state.baselineWidth === null) return viewport;
    if (!widthChanged) return viewport;

    const previousHeight = state.baselineHeight;
    const previousWidth = state.baselineWidth;
    const looksRotated = previousHeight !== null
      && previousWidth !== null
      && dimensionsApproximatelyMatch(viewport.width, previousHeight);
    const expectedFullHeight = looksRotated ? previousWidth : previousHeight;
    const nextBaselineHeight = Math.max(viewport.height, expectedFullHeight ?? viewport.height);

    if (viewport.height < nextBaselineHeight - 1) {
      // A resized WebView already exposes the new keyboard boundary. Preserve
      // that boundary instead of subtracting the stale pre-rotation height.
      state.height = nextBaselineHeight - viewport.height;
    } else if (nextBaselineHeight > viewport.width && previousHeight !== null) {
      // A frozen portrait viewport needs a conservative clamp until Capacitor
      // supplies its next height. The prior landscape height is a safe ceiling.
      state.height = Math.max(state.height, previousHeight);
    }
    state.height = Math.min(state.height, Math.max(0, nextBaselineHeight - 1));
    state.baselineHeight = nextBaselineHeight;
    state.baselineWidth = viewport.width;
    return viewport;
  }

  state.baselineHeight = widthChanged || state.baselineHeight === null
    ? viewport.height
    : Math.max(state.baselineHeight, viewport.height);
  state.baselineWidth = viewport.width;
  return viewport;
}

export function getVisibleViewport(
  targetWindow: Window = window,
  nativeKeyboard?: NativeKeyboardState,
): VisibleViewport {
  const viewport = getViewportIntersection(targetWindow);
  const keyboardHeight = positiveDimension(nativeKeyboard?.height);
  const baselineHeight = positiveDimension(nativeKeyboard?.baselineHeight);
  if (keyboardHeight === null || baselineHeight === null) return viewport;
  const nativeVisibleHeight = Math.max(1, baselineHeight - keyboardHeight);
  return {
    ...viewport,
    height: Math.min(viewport.height, nativeVisibleHeight),
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
  private readonly keyboardShowHandler = (event: Event) => {
    applyNativeKeyboardShow(sharedNativeKeyboard, event);
    this.schedule();
  };
  private readonly keyboardWillHideHandler = () => this.schedule();
  private readonly keyboardDidHideHandler = () => {
    clearNativeKeyboard(sharedNativeKeyboard);
    this.schedule();
  };

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
    for (const eventName of NATIVE_KEYBOARD_SHOW_EVENTS) {
      window.addEventListener(eventName, this.keyboardShowHandler);
    }
    window.addEventListener('keyboardWillHide', this.keyboardWillHideHandler);
    window.addEventListener('keyboardDidHide', this.keyboardDidHideHandler);
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
    const viewport = getVisibleViewport(window, sharedNativeKeyboard);
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
    for (const eventName of NATIVE_KEYBOARD_SHOW_EVENTS) {
      window.removeEventListener(eventName, this.keyboardShowHandler);
    }
    window.removeEventListener('keyboardWillHide', this.keyboardWillHideHandler);
    window.removeEventListener('keyboardDidHide', this.keyboardDidHideHandler);
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
  resetNativeKeyboard(sharedNativeKeyboard);

  const update = (): void => {
    const rawViewport = seedNativeKeyboardBaseline(sharedNativeKeyboard);
    const viewport = getVisibleViewport(window, sharedNativeKeyboard);
    const baselineHeight = positiveDimension(sharedNativeKeyboard.baselineHeight) ?? rawViewport.height;
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
  const handleKeyboardShow = (event: Event): void => {
    applyNativeKeyboardShow(sharedNativeKeyboard, event);
    schedule();
  };
  const handleKeyboardWillHide = (): void => schedule();
  const handleKeyboardDidHide = (): void => {
    clearNativeKeyboard(sharedNativeKeyboard);
    schedule();
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
  for (const eventName of NATIVE_KEYBOARD_SHOW_EVENTS) {
    window.addEventListener(eventName, handleKeyboardShow);
  }
  window.addEventListener('keyboardWillHide', handleKeyboardWillHide);
  window.addEventListener('keyboardDidHide', handleKeyboardDidHide);
  document.addEventListener('focusin', handleFocus, true);
  document.addEventListener('focusout', schedule, true);
  update();

  return () => {
    for (const timer of timers) window.clearTimeout(timer);
    window.visualViewport?.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    for (const eventName of NATIVE_KEYBOARD_SHOW_EVENTS) {
      window.removeEventListener(eventName, handleKeyboardShow);
    }
    window.removeEventListener('keyboardWillHide', handleKeyboardWillHide);
    window.removeEventListener('keyboardDidHide', handleKeyboardDidHide);
    document.removeEventListener('focusin', handleFocus, true);
    document.removeEventListener('focusout', schedule, true);
    resetNativeKeyboard(sharedNativeKeyboard);
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
