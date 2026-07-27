import type { App, Menu, TFile } from 'obsidian';
import { Notice } from 'obsidian';
import { openEntitySuggestModal } from '../modals/EntitySuggestModal';
import { resolveCustomProperties } from '../resolve-profiles';
import { ViewModeService } from '../services/view-mode-service';
import type { CustomProperty } from '../types';
import {
  isEntityReferenceProperty,
  mergeEntityReferenceList,
  removeEntityReferenceListValues,
} from '../utils/entity-property';
import { getWikilinkDisplayText, parseLinkListInput } from '../utils/list-utils';
import {
  readInlineFieldValue,
  readTaskLineTags,
  readTaskInlineFieldRecord,
} from '../utils/task-line-metadata';
import { setLogInlineFieldValue } from '../views/log-line-utils';
import * as logger from '../logger';

export interface LineEntityPropertyPluginLike {
  app: App;
  settings?: {
    properties?: CustomProperty[];
    showCustomPropertiesInContextMenu?: boolean;
  };
}

export interface AddLineEntityPropertyMenuOptions {
  app: App;
  plugin: LineEntityPropertyPluginLike;
  menu: Menu;
  file: TFile;
  rawLine: string;
  mutateLine: (
    updater: (currentLine: string) => string,
    property: CustomProperty,
    action: 'set' | 'clear' | 'remove',
  ) => Promise<unknown>;
  section?: string;
}

/**
 * Resolve constrained relationship properties against one Markdown line.
 *
 * Inline fields are presented as a frontmatter-shaped record because the
 * reusable property visibility engine is intentionally storage-agnostic.
 * Empty keys remain present, which keeps `blank`, `exists`, and `missing`
 * context-menu rules distinct.
 */
export function resolveLineEntityContextProperties(
  plugin: LineEntityPropertyPluginLike | null | undefined,
  file: TFile,
  rawLine: string,
): CustomProperty[] {
  if (!plugin || plugin.settings?.showCustomPropertiesInContextMenu === false) return [];
  const properties = plugin.settings?.properties || [];
  if (properties.length === 0) return [];

  const frontmatter: Record<string, unknown> = readTaskInlineFieldRecord(rawLine);
  const tags = readTaskLineTags(rawLine);
  if (tags.length > 0) frontmatter.tags = tags;

  return resolveCustomProperties(
    properties,
    [{ file, frontmatter }],
    new ViewModeService(),
    'context',
  ).filter((property) => (
    !!property
    && !property.disabled
    && !property.hidden
    && property.showInContextMenu !== false
    && property.type !== 'kind'
    && isEntityReferenceProperty(property)
  ));
}

export function getConfiguredEntityReferencePropertyKeys(
  plugin: LineEntityPropertyPluginLike | null | undefined,
): string[] {
  const keys = new Set<string>();
  for (const property of plugin?.settings?.properties || []) {
    if (!property || property.type === 'kind' || !isEntityReferenceProperty(property)) continue;
    const key = String(property.key || property.id || '').trim();
    if (key) keys.add(key);
  }
  return Array.from(keys);
}

/**
 * Add line-local relationship controls to a native Menu.
 *
 * The caller owns stale-target protection. Every mutation receives an updater
 * that must be applied to the current, re-resolved source line.
 */
export function addLineEntityPropertyMenus(
  options: AddLineEntityPropertyMenuOptions,
): CustomProperty[] {
  const properties = resolveLineEntityContextProperties(
    options.plugin,
    options.file,
    options.rawLine,
  );
  for (const property of properties) {
    addLineEntityPropertyMenu(options, property);
  }
  return properties;
}

function addLineEntityPropertyMenu(
  options: AddLineEntityPropertyMenuOptions,
  property: CustomProperty,
): void {
  const isList = property.type === 'list';
  const rawValue = readInlineFieldValue(options.rawLine, property.key);
  const current = isList
    ? parseLinkListInput(rawValue)
    : rawValue ? [rawValue] : [];
  const display = current
    .map((value) => getWikilinkDisplayText(value))
    .filter(Boolean)
    .join(', ');

  options.menu.addItem((item) => {
    item
      .setTitle(display
        ? `${property.label}: ${display}`
        : `${property.label} (create field)`)
      .setIcon(property.icon || 'file-search')
      .setSection(options.section || 'tps-line-properties');

    const subMenu = (item as any).setSubmenu();
    subMenu.addItem((sub: any) => {
      sub
        .setTitle('(none)')
        .setChecked(current.length === 0)
        .onClick(() => {
          runLineMutation(options, property, 'clear', (line) => (
            setLogInlineFieldValue(line, property.key, null)
          ));
        });
    });
    subMenu.addItem((sub: any) => {
      sub
        .setTitle(isList ? `Add ${property.label}…` : `Choose ${property.label}…`)
        .setIcon('search')
        .onClick(() => {
          openEntitySuggestModal(options.app, options.plugin as any, property, (choice) => {
            runLineMutation(options, property, 'set', (line) => {
              const nextValue = isList
                ? mergeEntityReferenceList(
                    readInlineFieldValue(line, property.key),
                    choice.wikilink,
                  ).join(', ')
                : choice.wikilink;
              return setLogInlineFieldValue(line, property.key, nextValue);
            });
          });
        });
    });

    if (isList && current.length > 0) {
      subMenu.addSeparator();
      for (const link of current) {
        subMenu.addItem((sub: any) => {
          sub
            .setTitle(`Remove ${getWikilinkDisplayText(link) || link}`)
            .setIcon('x')
            .onClick(() => {
              runLineMutation(options, property, 'remove', (line) => {
                const remaining = removeEntityReferenceListValues(
                  readInlineFieldValue(line, property.key),
                  link,
                );
                return setLogInlineFieldValue(
                  line,
                  property.key,
                  remaining.length > 0 ? remaining.join(', ') : null,
                );
              });
            });
        });
      }
    }
  });
}

function runLineMutation(
  options: AddLineEntityPropertyMenuOptions,
  property: CustomProperty,
  action: 'set' | 'clear' | 'remove',
  updater: (currentLine: string) => string,
): void {
  void Promise.resolve(options.mutateLine(updater, property, action)).catch((error) => {
    logger.flowError('LineEntityPropertyMenu', 'mutation:failed', error, {
      path: options.file.path,
      property: property.key,
      action,
    });
    new Notice(`Could not update ${property.label || property.key}.`);
  });
}
