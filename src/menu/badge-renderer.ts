import { App, Menu, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import { addSafeClickListener } from './menu-controller';
import { FULL_DATE_REGEX, stripDateSuffix } from '../utils/date-suffix-utils';
import { resolveCustomProperties } from '../resolve-profiles';
import { ViewModeService } from '../services/view-mode-service';
import { isTextListProperty } from '../utils/list-utils';
import { getEffectivePropertyOptions } from '../utils/property-options';

/**
 * Generate a consistent hue (0-360) from a string using a simple hash.
 * This ensures the same tag always gets the same color.
 */
export function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) % 360;
}

export class BadgeRenderer {
  private plugin: TPSGlobalContextMenuPlugin;
  private delegates: {
    createFileEntries: (files: TFile[]) => any[];
    getRecurrenceValue: (fm: any) => string;
    openAddTagModal: (entries: any[], key?: string) => void;
    openAddListValueModal: (entries: any[], key: string, label?: string) => void;
    openRecurrenceModalNative: (entries: any[]) => void;
    openScheduledModal: (entries: any[], key?: string) => void;
    openTypeSubmenu: (anchor: HTMLElement | MouseEvent | KeyboardEvent, entries: any[], onUpdate?: (val: string) => void) => void;
    showMenuAtAnchor: (menu: Menu, anchor: HTMLElement | MouseEvent | KeyboardEvent) => void;
    triggerTagSearch: (tag: string) => void;
  };

  constructor(
    plugin: TPSGlobalContextMenuPlugin,
    delegates: BadgeRenderer['delegates']
  ) {
    this.plugin = plugin;
    this.delegates = delegates;
  }

  private getValueCaseInsensitive(frontmatter: any, key: string): any {
    if (!frontmatter || !key) return undefined;
    if (key in frontmatter) return frontmatter[key];
    const lowerKey = key.toLowerCase();
    const match = Object.keys(frontmatter).find(k => k.toLowerCase() === lowerKey);
    return match ? frontmatter[match] : undefined;
  }

  private get app(): App {
    return this.plugin.app;
  }

  private filesFromEntries(entries: any[]): TFile[] {
    const files: TFile[] = [];
    const seen = new Set<string>();

    for (const entry of entries || []) {
      const file = this.resolveEntryFile(entry?.file ?? entry);
      if (!file || seen.has(file.path)) continue;
      seen.add(file.path);
      files.push(file);
    }

    if (files.length > 0) return files;

    const activeFile = this.app.workspace.getActiveFile();
    return activeFile instanceof TFile && this.isPropertyFile(activeFile)
      ? [activeFile]
      : [];
  }

  private isPropertyFile(file: TFile): boolean {
    const extension = file.extension?.toLowerCase();
    return extension === 'md' || extension === 'canvas';
  }

  private resolveEntryFile(candidate: unknown): TFile | null {
    if (candidate instanceof TFile && this.isPropertyFile(candidate)) {
      return candidate;
    }

    const path = typeof candidate === 'string'
      ? candidate
      : typeof (candidate as any)?.path === 'string'
        ? (candidate as any).path
        : '';

    if (!path) return null;
    const liveFile = this.app.vault.getAbstractFileByPath(path);
    return liveFile instanceof TFile && this.isPropertyFile(liveFile)
      ? liveFile
      : null;
  }

  private async afterWholeNotePropertyEdit(files: TFile[], changedKeys: string[]): Promise<void> {
    if (files.length === 0) return;
    await Promise.all(files.map((file) =>
      this.plugin.notebookNavigatorRuleService.applyRulesToFile(file, {
        reason: 'whole-note-inline-property-edit',
        force: true,
        bypassCreationGrace: true,
      }),
    ));
    for (const file of files) {
      this.plugin.persistentMenuManager?.refreshMenusForFile(file, true);
    }
    this.plugin.viewModeManager?.handlePotentialFrontmatterChange(files, changedKeys);
  }

  createSummaryHeader(file: TFile, leaf?: WorkspaceLeaf): HTMLElement {
    const entries = this.delegates.createFileEntries([file]);
    const fm = entries[0].frontmatter;

    const header = document.createElement('div');
    header.className = 'tps-global-context-header';

    // Left container with collapse button
    const left = document.createElement('div');
    left.className = 'tps-gcm-header-left';

    const collapseButton = document.createElement('button');
    collapseButton.type = 'button';
    collapseButton.className = 'tps-gcm-collapse-button';
    collapseButton.setAttribute('aria-expanded', 'false');
    collapseButton.setAttribute('aria-label', 'Expand inline menu controls');
    left.appendChild(collapseButton);

    const title = document.createElement('span');
    title.className = 'tps-gcm-file-title';

    let displayTitle = fm.title && fm.title !== file.basename
      ? `${fm.title} (${file.basename})`
      : (fm.title || file.basename || 'Untitled');

    if (!FULL_DATE_REGEX.test(displayTitle)) {
      displayTitle = stripDateSuffix(displayTitle);
    }

    title.textContent = displayTitle;
    title.setAttribute('aria-label', file.path);
    left.appendChild(title);

    header.appendChild(left);

    // Container for badges (right side)
    const right = this.createHeaderBadges(file, leaf);
    header.appendChild(right);

    return header;
  }

  /**
   * Create just the header badges container.
   * This is separated so we can update badges in-place without recreating the whole menu.
   */
  createHeaderBadges(file: TFile, leaf?: WorkspaceLeaf): HTMLElement {
    const entries = this.delegates.createFileEntries([file]);
    const fm = entries[0].frontmatter;

    const right = document.createElement('div');
    right.className = 'tps-gcm-header-right';

    if (this.plugin.settings.showCustomPropertiesInInlineUi === false) {
      return right;
    }

    // Helper to create badge
    const createBadge = (text: string, type: string, icon: string | null, onClick: (e: MouseEvent) => void) => {
      const badge = document.createElement('span');
      badge.className = `tps-gcm-badge tps-gcm-badge-${type}`;
      badge.textContent = text;
      addSafeClickListener(badge, onClick);
      return badge;
    };

    // Collect badges in two arrays: non-tags first, then tags
    const nonTagBadges: HTMLElement[] = [];
    const tagBadges: HTMLElement[] = [];

    // Dynamically create badges based on configured properties
    const properties = resolveCustomProperties(this.plugin.settings.properties || [], entries, new ViewModeService(), 'inline');
    properties.forEach(prop => {
      if (prop.showInCollapsed === false) return;
      if (prop.type === 'selector') {
        const rawValue = this.getValueCaseInsensitive(fm, prop.key);
        const value =
          rawValue === undefined || rawValue === null ? '' : String(rawValue).trim();
        if (value) {
          const badge = createBadge(value, `${prop.key} tps-gcm-badge-${value}`, null, (e) => {
            e.stopPropagation();
            const menu = new Menu();
            const files = this.filesFromEntries(entries);
            const allWithoutKey = entries.every((entry: any) => {
              const fmEntry = entry?.frontmatter || {};
              return !Object.prototype.hasOwnProperty.call(fmEntry, prop.key);
            });
            const allEmpty = !allWithoutKey && entries.every((entry: any) => {
              const fmEntry = entry?.frontmatter || {};
              const propValue = fmEntry[prop.key];
              return propValue === '' || propValue === null || propValue === undefined;
            });

            menu.addItem((item: any) => {
              item.setTitle('(none)')
                .setChecked(allWithoutKey)
                .onClick(async () => {
                  await this.plugin.bulkEditService.removeFrontmatterKey(files, prop.key);
                  await this.afterWholeNotePropertyEdit(files, [prop.key]);
                  (e.target as HTMLElement).remove();
                });
            });
            menu.addItem((item: any) => {
              item.setTitle('(empty)')
                .setChecked(allEmpty)
                .onClick(async () => {
                  await this.plugin.bulkEditService.updateFrontmatter(files, { [prop.key]: '' });
                  await this.afterWholeNotePropertyEdit(files, [prop.key]);
                  (e.target as HTMLElement).remove();
                });
            });
            menu.addSeparator();
            getEffectivePropertyOptions(this.app, prop).forEach((opt: string) => {
              menu.addItem((item: any) => {
                item.setTitle(opt)
                  .setChecked(this.getValueCaseInsensitive(fm, prop.key) === opt)
                  .onClick(async () => {
                    await this.plugin.bulkEditService.updateFrontmatter(files, { [prop.key]: opt });
                    await this.afterWholeNotePropertyEdit(files, [prop.key]);
                    (e.target as HTMLElement).textContent = opt;
                    (e.target as HTMLElement).className = `tps-gcm-badge tps-gcm-badge-${prop.key} tps-gcm-badge-${opt}`;
                  });
              });
            });
            this.delegates.showMenuAtAnchor(menu, e);
          });
          nonTagBadges.push(badge);
        }
      } else if (prop.type === 'list') {
        const listValues = this.getValueCaseInsensitive(fm, prop.key);
        const isTextList = isTextListProperty(prop);

        if (listValues && listValues !== false && listValues !== null) {
          const rawItems = Array.isArray(listValues) ? listValues : [listValues];
          const items = rawItems.filter((v: any) => typeof v === 'string' && v.trim());
          items.slice(0, 4).forEach((item: string) => {
            const cleanItem = isTextList ? item.trim() : item.replace('#', '');
            const badge = document.createElement('span');
            badge.className = isTextList ? 'tps-gcm-badge' : 'tps-gcm-badge tps-gcm-badge-tag';

            const removeBtn = document.createElement('button');
            removeBtn.className = 'tps-gcm-badge-tag-remove';
            removeBtn.type = 'button';
            removeBtn.textContent = '×';
            addSafeClickListener(removeBtn, async (e) => {
              e.stopPropagation();
              if (isTextList) {
                const files = this.filesFromEntries(entries);
                await this.plugin.bulkEditService.removeListValues(files, cleanItem, prop.key);
                await this.afterWholeNotePropertyEdit(files, [prop.key]);
                this.plugin.bulkEditService.showNotice('removed', `${prop.label || prop.key} ${cleanItem}`, '', entries.length);
              } else {
                const files = this.filesFromEntries(entries);
                await this.plugin.bulkEditService.removeTag(files, cleanItem, prop.key);
                await this.afterWholeNotePropertyEdit(files, [prop.key, 'tags']);
                this.plugin.bulkEditService.showNotice('removed', `Tag #${cleanItem}`, '', entries.length);
              }
              badge.remove();
            });
            badge.appendChild(removeBtn);

            const text = document.createElement('span');
            text.className = 'tps-gcm-badge-tag-text';
            text.textContent = cleanItem;
            badge.appendChild(text);

            addSafeClickListener(badge, (e) => {
              e.stopPropagation();
              if (!isTextList) this.delegates.triggerTagSearch(cleanItem);
            });

            // Consistent color based on tag hash
            const hue = hashStringToHue(cleanItem);
            badge.style.backgroundColor = `hsla(${hue}, 40%, 20%, 0.4)`;
            badge.style.color = `hsl(${hue}, 60%, 85%)`;
            badge.style.border = `1px solid hsla(${hue}, 40%, 30%, 0.5)`;

            tagBadges.push(badge);
          });
          if (items.length > 4) {
            tagBadges.push(createBadge(`+${items.length - 4}`, 'tag-more', null, (e) => {
              e.stopPropagation();
              if (isTextList) this.delegates.openAddListValueModal(entries, prop.key, prop.label);
              else this.delegates.openAddTagModal(entries, prop.key);
            }));
          }
        }

        // Add the "+" button AFTER the tags
        const addBadge = createBadge('+', 'add-tag', null, (e) => {
          e.stopPropagation();
          if (isTextList) this.delegates.openAddListValueModal(entries, prop.key, prop.label);
          else this.delegates.openAddTagModal(entries, prop.key);
        });
        tagBadges.push(addBadge);
      } else if (prop.type === 'recurrence') {
        const recurrence = this.delegates.getRecurrenceValue(fm);
        if (recurrence) {
          let label = 'Recur';
          const normalized = recurrence.toUpperCase();
          if (normalized === 'GCM-HOLIDAY:EASTER') label = 'Easter';
          else if (normalized.includes('BYMONTH=5') && normalized.includes('BYDAY=2SU')) label = "Mother's Day";
          else if (normalized.includes('FREQ=DAILY')) label = 'Daily';
          else if (normalized.includes('FREQ=WEEKLY')) label = 'Weekly';
          else if (normalized.includes('FREQ=MONTHLY')) label = 'Monthly';
          else if (normalized.includes('FREQ=YEARLY')) label = 'Yearly';

          nonTagBadges.push(createBadge(label, 'recurrence', null, (e) => {
            e.stopPropagation();
            this.delegates.openRecurrenceModalNative(entries);
          }));
        }
      } else if (prop.type === 'datetime') {
        const dateValue = fm[prop.key];
        if (dateValue) {
          const dateStr = dateValue.split('T')[0];
          nonTagBadges.push(createBadge(dateStr, prop.key, null, (e) => {
            e.stopPropagation();
            this.delegates.openScheduledModal(entries, prop.key);
          }));
        }
      } else if (prop.type === 'folder') {
        const folderPath = file.parent?.path || '/';
        nonTagBadges.push(createBadge(folderPath, 'folder', null, (e) => {
          e.stopPropagation();
          this.delegates.openTypeSubmenu(e, entries);
        }));
      }
    });

    // Append non-tag badges first
    nonTagBadges.forEach(badge => right.appendChild(badge));

    // Append tag badges last
    tagBadges.forEach(badge => right.appendChild(badge));

    return right;
  }
}
