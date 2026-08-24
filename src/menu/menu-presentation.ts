import type { MenuItem } from 'obsidian';

export const GCM_MENU_LABEL_MAX_CHARACTERS = 25;

export function truncateGcmMenuLabel(value: string): string {
  const characters = Array.from(String(value || ''));
  if (characters.length <= GCM_MENU_LABEL_MAX_CHARACTERS) return characters.join('');
  return `${characters.slice(0, GCM_MENU_LABEL_MAX_CHARACTERS - 1).join('')}…`;
}

/** Bounds visible labels while preserving the complete text for hover and AT. */
export function constrainGcmMenu<T>(menu: T, options: { truncateText?: boolean } = {}): T {
  const candidate = menu as any;
  if (!candidate?.addItem || candidate.__tpsGcmLabelConstraint === true) return menu;

  const addItem = candidate.addItem.bind(candidate);
  candidate.__tpsGcmLabelConstraint = true;
  candidate.addItem = (callback: (item: MenuItem) => unknown) => addItem((item: any) => {
    const setTitle = item.setTitle.bind(item);
    item.setTitle = (title: string | DocumentFragment) => {
      if (typeof title !== 'string') return setTitle(title);
      const result = setTitle(options.truncateText === true ? truncateGcmMenuLabel(title) : title);
      const applyPresentation = () => {
        const itemEl = item?.dom?.el || item?.dom || item?.el;
        const titleEl = item?.titleEl || itemEl?.querySelector?.('.menu-item-title') || itemEl;
        itemEl?.classList?.add?.('tps-gcm-bounded-menu-item');
        titleEl?.setAttribute?.('title', title);
        titleEl?.setAttribute?.('aria-label', title);
      };
      applyPresentation();
      globalThis.setTimeout(applyPresentation, 0);
      return result;
    };
    if (typeof item.setSubmenu === 'function') {
      const setSubmenu = item.setSubmenu.bind(item);
      item.setSubmenu = () => constrainGcmMenu(setSubmenu(), options);
    }
    return callback(item);
  });

  const menuEl = candidate?.dom?.el || candidate?.dom || candidate?.menuEl;
  menuEl?.classList?.add?.('tps-gcm-bounded-menu');
  return menu;
}
