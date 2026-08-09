import { Menu } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';

/**
 * Monkey-patches `Menu.prototype.showAtPosition` and `Menu.prototype.showAtMouseEvent`
 * so that TPS items are always injected and de-duplicated against native items right
 * before the menu is displayed.
 *
 * Returns a cleanup function that restores the original prototype methods.
 * Store the return value in `this.restoreMenuPatch` and call it in `onunload`.
 */
export function setupMenuPatch(plugin: TPSGlobalContextMenuPlugin): () => void {
    const originalShowAtPosition = Menu.prototype.showAtPosition;
    const originalShowAtMouseEvent = Menu.prototype.showAtMouseEvent;

    const reorderItems = (menu: Menu) => {
        if (!(menu as any)._tpsHandled) return;
        const items = (menu as any).items as any[] | undefined;
        if (!Array.isArray(items) || items.length === 0) return;

        const normalizeTitle = (value: string): string =>
            value
                .toLowerCase()
                .replace(/[.…]+/g, '...')
                .replace(/\s+/g, ' ')
                .trim();

        const getItemTitle = (item: any): string => {
            const direct = typeof item?.title === 'string' ? item.title : '';
            if (direct) return direct;
            const fromDom = typeof item?.dom?.textContent === 'string' ? item.dom.textContent : '';
            if (fromDom) return fromDom;
            const fromTitleEl = typeof item?.titleEl?.textContent === 'string' ? item.titleEl.textContent : '';
            if (fromTitleEl) return fromTitleEl;
            return '';
        };

        const toSemanticKey = (title: string): string | null => {
            if (!title) return null;
            let normalized = normalizeTitle(title)
                .replace(/\(\s*\d+\s+(items?|notes?|files?)\s*\)/g, '')
                .replace(/\b\d+\s+(items?|notes?|files?)\b/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (!normalized) return null;
            if (/^delete\b/.test(normalized)) return 'action:delete';
            if (/^duplicate\b/.test(normalized)) return 'action:duplicate';
            if (/^move\b.*\bto\b/.test(normalized)) return 'action:move';
            if (/^open\b.*\bnew tabs?\b/.test(normalized) || /^open in new tab\b/.test(normalized)) return 'action:open-new-tab';
            if (/^open\b.*\bto the right\b/.test(normalized)) return 'action:open-right';
            if (/^open\b.*\bnew windows?\b/.test(normalized) || /^open in new window\b/.test(normalized)) return 'action:open-new-window';
            if (/^open\b.*\bsame tab\b/.test(normalized) || /^open in same tab\b/.test(normalized)) return 'action:open-same-tab';
            return null;
        };

        const getDedupeKeys = (item: any): string[] => {
            const title = getItemTitle(item);
            if (!title) return [];
            const normalized = normalizeTitle(title);
            const keys = [`title:${normalized}`];
            const semantic = toSemanticKey(title);
            if (semantic) keys.push(semantic);
            return keys;
        };

        const getBulkCount = (item: any): number | null => {
            const title = getItemTitle(item);
            if (!title) return null;
            const normalized = normalizeTitle(title);
            const match =
                normalized.match(/\(\s*(\d+)\s+(?:items?|notes?|files?)\s*\)/) ??
                normalized.match(/\b(\d+)\s+(?:items?|notes?|files?)\b/);
            if (!match) return null;
            const count = Number(match[1]);
            return Number.isFinite(count) && count > 1 ? count : null;
        };

        const getBulkCountBySemanticKey = (itemsToScan: any[]): Map<string, number> => {
            const counts = new Map<string, number>();
            for (const item of itemsToScan) {
                const count = getBulkCount(item);
                if (count === null) continue;
                const semantic = getDedupeKeys(item).find((key) => key.startsWith('action:'));
                if (!semantic) continue;
                counts.set(semantic, count);
            }
            return counts;
        };

        const compactMenuItems = (sourceItems: any[]): any[] => {
            const compacted: any[] = [];
            let previousWasSeparator = true;
            for (const item of sourceItems) {
                const isSeparator = !getItemTitle(item);
                if (isSeparator) {
                    if (previousWasSeparator) continue;
                    compacted.push(item);
                    previousWasSeparator = true;
                    continue;
                }
                compacted.push(item);
                previousWasSeparator = false;
            }
            while (compacted.length > 0 && !getItemTitle(compacted[compacted.length - 1])) {
                compacted.pop();
            }
            return compacted;
        };

        const createSubmenuItem = (title: string, icon: string, section: string, submenuItems: any[]): any | null => {
            let parentItem: any = null;
            menu.addItem((item: any) => {
                parentItem = item;
                item.setTitle(title)
                    .setIcon(icon)
                    .setSection(section);
                const subMenu = item.setSubmenu();
                (subMenu as any).items = submenuItems;
            });
            if (parentItem) {
                (parentItem as any)._isTpsItem = true;
            }
            return parentItem;
        };

        const tpsItems: any[] = [];
        const otherItems: any[] = [];
        for (const item of items) {
            if ((item as any)._isTpsItem) {
                tpsItems.push(item);
            } else {
                otherItems.push(item);
            }
        }

        if (tpsItems.length === 0) return;

        const tpsBulkCounts = getBulkCountBySemanticKey(tpsItems);
        const nativeBulkCounts = getBulkCountBySemanticKey(otherItems);
        for (const [key, nativeCount] of nativeBulkCounts.entries()) {
            const tpsCount = tpsBulkCounts.get(key);
            if (typeof tpsCount === 'number' && tpsCount !== nativeCount) {
                const contextTarget = (menu as any)._tpsContextTarget instanceof HTMLElement
                    ? (menu as any)._tpsContextTarget
                    : null;
                const inferredFiles = plugin.contextTargetService.inferNotebookNavigatorCollectionSelection(contextTarget, nativeCount);
                if (inferredFiles.length === nativeCount) {
                    logger.flow('MenuPatcher', 'rebuilt-notebook-navigator-menu', {
                        action: key,
                        count: nativeCount,
                    });
                    (menu as any).items = otherItems;
                    (menu as any)._tpsHandled = false;
                    plugin.menuController.addToNativeMenu(menu, inferredFiles);
                    reorderItems(menu);
                    return;
                }
                logger.flowWarn('MenuPatcher', 'notebook-navigator-selection-count-mismatch', {
                    action: key,
                    gcmCount: tpsCount,
                    notebookNavigatorCount: nativeCount,
                });
                const compactedNative = compactMenuItems(otherItems);
                const scopedTpsItems = compactMenuItems(tpsItems);
                const scopedItem = createSubmenuItem(
                    `GCM options (${tpsCount} resolved / ${nativeCount} selected)`,
                    'list-checks',
                    'tps-selection-warning',
                    scopedTpsItems,
                );
                (menu as any).items = scopedItem ? [scopedItem, ...compactedNative] : compactedNative;
                return;
            }
        }

        const preferredKeys = new Set<string>();
        for (const item of tpsItems) {
            for (const key of getDedupeKeys(item)) {
                preferredKeys.add(key);
            }
        }

        const filteredOthers = otherItems.filter((item) => {
            const keys = getDedupeKeys(item);
            if (keys.length === 0) return true;
            return !keys.some((key) => preferredKeys.has(key));
        });

        const nestedNativeItems = compactMenuItems(filteredOthers);
        if (nestedNativeItems.length === 0) {
            (menu as any).items = tpsItems;
            return;
        }

        const nativeOptionsItem = createSubmenuItem('More options', 'ellipsis', 'tps-native-options', nestedNativeItems);
        if (nativeOptionsItem) {
            (menu as any).items = [...tpsItems, nativeOptionsItem];
            return;
        }

        (menu as any).items = [...tpsItems, ...nestedNativeItems];
    };

    Menu.prototype.showAtPosition = function (pos) {
        const targetEl = plugin.contextTargetService.peekRecentContextTarget(1200);
        if (!plugin.contextTargetService.isNotebookNavigatorContextTarget(targetEl)) {
            reorderItems(this);
        }
        try {
            return originalShowAtPosition.call(this, pos);
        } finally {
            plugin.contextTargetService.clearRecentContextTarget();
        }
    };

    Menu.prototype.showAtMouseEvent = function (evt) {
        const targetEl = evt?.target instanceof HTMLElement ? evt.target : null;
        if (!plugin.contextTargetService.isNotebookNavigatorContextTarget(targetEl)) {
            plugin.foldExpansionContextMenuService?.addMenuItemForTarget(this, targetEl, evt ?? null);
            reorderItems(this);
        }
        try {
            return originalShowAtMouseEvent.call(this, evt);
        } finally {
            plugin.contextTargetService.clearRecentContextTarget();
        }
    };

    return () => {
        Menu.prototype.showAtPosition = originalShowAtPosition;
        Menu.prototype.showAtMouseEvent = originalShowAtMouseEvent;
    };
}
