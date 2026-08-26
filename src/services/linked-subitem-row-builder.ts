/**
 * Unified row builder for linked subitem rows.
 * Provides consistent DOM structure for both reading mode and Live Preview.
 */
import { setIcon } from 'obsidian';
import type { TFile } from 'obsidian';
import type { SubitemLineModel, PropertyPill } from './subitem-line-model';

export interface LinkedSubitemRowElements {
  /** Container element for the entire row */
  container: HTMLElement;
  /** Checkbox button element */
  checkbox: HTMLElement | null;
  /** Link text element */
  link: HTMLElement;
  /** Pills container */
  pillsContainer: HTMLElement;
}

/**
 * Build a complete linked subitem row DOM structure.
 * This is the single source of truth for row rendering in both modes.
 */
export function buildLinkedSubitemRow(
  model: SubitemLineModel,
  onCheckboxClick: (evt: MouseEvent) => void,
  onLinkClick: (path: string) => void,
  onPillClick: (evt: MouseEvent, pill: PropertyPill) => void,
  options?: { includeCheckbox?: boolean },
): LinkedSubitemRowElements {
  // Container for the entire row content
  const container = document.createElement('span');
  container.className = 'tps-gcm-linked-subitem-row tps-gcm-linked-subitem-row-content';
  container.dataset.linkedSubitemPath = model.childFile.path;
  container.dataset.linkedSubitemParent = model.parentFile.path;

  const includeCheckbox = options?.includeCheckbox === true;
  let checkbox: HTMLElement | null = null;
  if (includeCheckbox && model.checkboxState) {
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.className = `tps-gcm-linked-subitem-checkbox state-${model.visualState}`;
    if (model.kind !== 'checkbox') {
      button.classList.add('is-bullet');
    }
    button.setAttribute('aria-label', 'Toggle linked subitem status');
    button.dataset.linkedSubitemPath = model.childFile.path;
    button.dataset.linkedSubitemParent = model.parentFile.path;
    button.dataset.linkedSubitemState = model.checkboxState || '[ ]';
    setIcon(button, getIconNameForModel(model));
    button.addEventListener('mousedown', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    button.addEventListener('touchstart', (evt) => {
      evt.stopPropagation();
    }, { passive: true });
    button.addEventListener('click', onCheckboxClick);
    container.appendChild(button);
    checkbox = button;
  }

  // Link text
  const link = document.createElement('span');
  link.className = 'tps-gcm-linked-subitem-link';
  link.textContent = model.displayLabel;
  link.title = model.displayLabel;
  link.dataset.linkedSubitemPath = model.childFile.path;
  link.setAttribute('role', 'link');
  link.setAttribute('aria-label', model.displayLabel);
  link.tabIndex = 0;
  link.addEventListener('mousedown', (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
  });
  link.addEventListener('click', (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    onLinkClick(model.childFile.path);
  });
  link.addEventListener('keydown', (evt) => {
    if (evt.key !== 'Enter') return;
    evt.preventDefault();
    evt.stopPropagation();
    link.click();
  });
  container.appendChild(link);

  // Pills container
  const pillsContainer = document.createElement('span');
  pillsContainer.className = 'tps-gcm-linked-subitem-pills';
  for (const pillData of model.pills) {
    const pill = document.createElement('span');
    pill.className = `tps-gcm-linked-subitem-pill tps-gcm-linked-subitem-pill--${pillData.kind}`;
    pill.textContent = pillData.label;
    pill.title = pillData.label;
    pill.setAttribute('aria-label', pillData.label);
    pill.setAttribute('role', 'button');
    pill.tabIndex = 0;
    pill.dataset.linkedSubitemPath = model.childFile.path;
    pill.dataset.linkedSubitemPillKind = pillData.kind;
    pill.dataset.linkedSubitemPillValue = pillData.value || pillData.label;
    if (pillData.propertyKey) pill.dataset.linkedSubitemPropertyKey = pillData.propertyKey;
    if (pillData.propertyType) pill.dataset.linkedSubitemPropertyType = pillData.propertyType;
    pill.addEventListener('mousedown', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    pill.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      onPillClick(evt, pillData);
    });
    pill.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Enter' && evt.key !== ' ') return;
      evt.preventDefault();
      evt.stopPropagation();
      pill.click();
    });
    pillsContainer.appendChild(pill);
  }
  container.appendChild(pillsContainer);

  return { container, checkbox, link, pillsContainer };
}

/**
 * Get the icon name for a checkbox state.
 */
export function getIconNameForState(state: string): string {
  if (/[xX]/.test(state)) return 'check';
  if (state.includes('/') || state.includes('\\')) return 'slash';
  if (state.includes('?')) return 'help-circle';
  if (state.includes('-')) return 'minus';
  return 'square';
}

export function getIconNameForModel(model: SubitemLineModel): string {
  if (model.kind !== 'checkbox' && model.visualState === 'open') return 'circle';
  return model.checkboxIcon || getIconNameForState(model.checkboxState || '[ ]');
}

/**
 * Update checkbox DOM element to reflect new state.
 */
export function updateCheckboxState(checkbox: HTMLElement, newState: string, visualState: string): void {
  checkbox.dataset.linkedSubitemState = newState;
  checkbox.className = `tps-gcm-linked-subitem-checkbox state-${visualState}`;
  checkbox.innerHTML = '';
  setIcon(checkbox, getIconNameForState(newState));
}
