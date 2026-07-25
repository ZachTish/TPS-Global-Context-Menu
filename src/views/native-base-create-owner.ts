const NATIVE_BASE_CREATE_CANDIDATE_SELECTOR = [
  'button',
  '.clickable-icon',
  '[role="button"]',
  '[aria-label]',
  '[title]',
  '.bases-toolbar > *',
  '.bases-header > *',
].join(', ');

const NATIVE_BASE_CREATE_CHROME_SELECTOR = [
  '.bases-toolbar',
  '.bases-header',
  '.bases-view-header',
  '.base-view-header',
].join(', ');

const NATIVE_BASE_CREATE_EXCLUDED_SELECTOR = [
  '.modal',
  '.modal-container',
  '.menu',
  '.popover',
  '.suggestion-container',
  '.prompt',
].join(', ');

const PLUS_ICON_SELECTOR = '.lucide-plus, [data-lucide="plus"], [data-icon="plus"]';

export function getTpsBaseNativeCreateEventTarget(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

export function isTpsBaseNativeCreateTarget(target: Element, scope: HTMLElement): boolean {
  if (target.closest(NATIVE_BASE_CREATE_EXCLUDED_SELECTOR)) return false;
  const candidate = target.closest<Element>(NATIVE_BASE_CREATE_CANDIDATE_SELECTOR);
  if (!candidate || !scope.contains(candidate)) return false;
  if (candidate.closest('.workspace-tab-header, .mod-left-split, .mod-right-split')) return false;
  const baseChrome = candidate.closest<HTMLElement>(NATIVE_BASE_CREATE_CHROME_SELECTOR);
  if (!baseChrome || !scope.contains(baseChrome)) return false;

  const label = [
    candidate.getAttribute('aria-label'),
    candidate.getAttribute('title'),
    candidate.textContent,
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean).join(' ');
  if (/\b(view|property|properties|filter|column|sort|group)\b/.test(label)) return false;
  const hasPlusIcon = candidate.matches(PLUS_ICON_SELECTOR)
    || candidate.querySelector(PLUS_ICON_SELECTOR) != null;
  return /\b(new|create|add)\b/.test(label)
    || (hasPlusIcon && isLastBaseChromeControl(candidate, baseChrome));
}

function isLastBaseChromeControl(candidate: Element, baseChrome: HTMLElement): boolean {
  let chromeChild: Element = candidate;
  while (chromeChild.parentElement && chromeChild.parentElement !== baseChrome) {
    chromeChild = chromeChild.parentElement;
  }
  return chromeChild.parentElement === baseChrome && chromeChild === baseChrome.lastElementChild;
}
