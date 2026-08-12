import type { App, Menu, TFile } from 'obsidian';
import { Notice } from 'obsidian';
import { RecurrenceModal } from '../modals/recurrence-modal';
import { ScheduledModal } from '../modals/scheduled-modal';
import { resolveCustomProperties } from '../resolve-profiles';
import { ViewModeService } from '../services/view-mode-service';
import type { CustomProperty } from '../types';
import {
  mergeEntityReferenceList,
  mergeMixedEntityReferenceList,
  removeEntityReferenceListValues,
  removeMixedEntityReferenceListValues,
} from '../utils/entity-property';
import {
  getWikilinkDisplayText,
  isLinkListProperty,
  isTagListProperty,
  mergeLinkList,
  mergeMixedList,
  mergeStringList,
  parseLinkListInput,
  parseMixedListInput,
  parseStringListInput,
  removeStringListValues,
} from '../utils/list-utils';
import { propertyUsesEntityOptions } from '../utils/property-option-source';
import {
  readInlineFieldValue,
  readTaskLineTags,
  readTaskInlineFieldRecord,
} from '../utils/task-line-metadata';
import {
  setLogInlineFieldValue,
  toggleLogLineSemanticTag,
} from '../views/log-line-utils';
import * as logger from '../logger';
import { addPropertyValueChoiceMenuItems } from './property-value-choice-menu';

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
  excludePropertyKeys?: readonly string[];
}

/**
 * Resolve configured writable properties against one Markdown line.
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
    && property.type !== 'folder'
  ));
}

export function getConfiguredLineContextPropertyKeys(
  plugin: LineEntityPropertyPluginLike | null | undefined,
): string[] {
  const keys = new Set<string>();
  for (const property of plugin?.settings?.properties || []) {
    if (
      !property
      || property.type === 'folder'
      || property.disabled
      || property.hidden
      || property.showInContextMenu === false
    ) continue;
    const key = String(property.key || property.id || '').trim();
    if (key) keys.add(key);
  }
  return Array.from(keys);
}

/** @deprecated Use getConfiguredLineContextPropertyKeys. */
export const getConfiguredEntityReferencePropertyKeys = getConfiguredLineContextPropertyKeys;

/**
 * Add line-local configured-property controls to a native Menu.
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
  const excluded = new Set(
    (options.excludePropertyKeys || [])
      .map((key) => String(key || '').trim().toLocaleLowerCase())
      .filter(Boolean),
  );
  for (const property of properties) {
    const key = String(property.key || property.id || '').trim().toLocaleLowerCase();
    if (!key || excluded.has(key)) continue;
    addLineConfiguredPropertyMenu(options, property);
  }
  return properties.filter((property) => (
    !excluded.has(String(property.key || property.id || '').trim().toLocaleLowerCase())
  ));
}

function addLineConfiguredPropertyMenu(
  options: AddLineEntityPropertyMenuOptions,
  property: CustomProperty,
): void {
  const entityOptions = propertyUsesEntityOptions(property);
  if (!entityOptions && (property.type === 'datetime' || property.type === 'snooze')) {
    addLineDatetimePropertyMenu(options, property);
    return;
  }
  if (!entityOptions && property.type === 'recurrence') {
    addLineRecurrencePropertyMenu(options, property);
    return;
  }
  if (!entityOptions && property.type === 'checkbox') {
    addLineCheckboxPropertyMenu(options, property);
    return;
  }

  const isList = property.type === 'list';
  const rawValue = readInlineFieldValue(options.rawLine, property.key);
  // Entity-enabled tag lists are relational fields, not semantic hashtag
  // storage. Their literal and entity values may coexist, so they must use
  // the same mixed-list parser and mutation helpers as every other
  // entity-enabled list.
  const isTags = isList && !entityOptions && isTagListProperty(property);
  const current = isTags
    ? readTaskLineTags(options.rawLine)
    : isList
      ? isLinkListProperty(property)
        ? parseLinkListInput(rawValue)
        : entityOptions
          ? parseMixedListInput(rawValue)
          : parseStringListInput(rawValue)
    : rawValue ? [rawValue] : [];
  const display = current
    .map((value) => /^\[\[/u.test(value) ? getWikilinkDisplayText(value) : value)
    .filter(Boolean)
    .join(', ');

  options.menu.addItem((item) => {
    item
      .setTitle(display
        ? `${property.label}: ${display}`
        : `${property.label} (create field)`)
      .setIcon(property.icon || (isList ? 'list' : 'pencil'))
      .setSection(options.section || 'tps-line-properties');

    const subMenu = (item as any).setSubmenu();
    const setChoice = (value: string, entity: boolean): void => {
      if (property.type === 'number' && !Number.isFinite(Number(value))) {
        new Notice('Enter a valid number.');
        return;
      }
      runLineMutation(options, property, 'set', (line) => {
        if (!isList) return setLogInlineFieldValue(line, property.key, value);
        if (isTags) {
          return toggleLogLineSemanticTag(line, property.key, value, false);
        }
        const existing = readInlineFieldValue(line, property.key);
        const nextValue = entity
          ? isLinkListProperty(property)
            ? mergeEntityReferenceList(existing, value)
            : mergeMixedEntityReferenceList(existing, value)
          : isLinkListProperty(property)
            ? mergeLinkList(existing, value)
            : entityOptions
              ? mergeMixedList(existing, value)
              : mergeStringList(existing, value);
        return setLogInlineFieldValue(line, property.key, nextValue.join(', '));
      });
    };
    addPropertyValueChoiceMenuItems({
      app: options.app,
      source: options.plugin as any,
      menu: subMenu,
      property,
      currentValue: isList ? current : rawValue,
      onClear: () => runLineMutation(options, property, 'clear', (line) => (
        isTags
          ? current.reduce(
              (next, tag) => toggleLogLineSemanticTag(next, property.key, tag, true),
              line,
            )
          : setLogInlineFieldValue(line, property.key, null)
      )),
      onChooseLiteral: (value) => setChoice(value, false),
      onChooseEntity: (choice) => setChoice(choice.wikilink, true),
    });

    if (isList && current.length > 0) {
      subMenu.addSeparator();
      for (const link of current) {
        subMenu.addItem((sub: any) => {
          sub
            .setTitle(`Remove ${/^\[\[/u.test(link) ? getWikilinkDisplayText(link) : link}`)
            .setIcon('x')
            .onClick(() => {
              runLineMutation(options, property, 'remove', (line) => {
                if (isTags) {
                  return toggleLogLineSemanticTag(line, property.key, link, true);
                }
                const existing = readInlineFieldValue(line, property.key);
                const remaining = isLinkListProperty(property)
                  ? removeEntityReferenceListValues(existing, link)
                  : entityOptions
                    ? removeMixedEntityReferenceListValues(existing, link)
                    : removeStringListValues(existing, link);
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

function addLineCheckboxPropertyMenu(
  options: AddLineEntityPropertyMenuOptions,
  property: CustomProperty,
): void {
  const current = readInlineFieldValue(options.rawLine, property.key).trim().toLocaleLowerCase();
  const normalizedCurrent = !current
    ? ''
    : /^(?:true|yes|1|on)$/u.test(current)
      ? 'true'
      : 'false';
  options.menu.addItem((item) => {
    item
      .setTitle(current
        ? `${property.label}: ${normalizedCurrent === 'true' ? 'Yes' : 'No'}`
        : `${property.label} (create field)`)
      .setIcon(property.icon || 'square-check-big')
      .setSection(options.section || 'tps-line-properties');
    const subMenu = (item as any).setSubmenu();
    const choices: Array<[string, string | null]> = [
      ['(none)', null],
      ['Yes', 'true'],
      ['No', 'false'],
    ];
    for (const [label, value] of choices) {
      subMenu.addItem((sub: any) => {
        sub
          .setTitle(label)
          .setChecked(value == null ? !current : normalizedCurrent === value)
          .onClick(() => {
            runLineMutation(options, property, value == null ? 'clear' : 'set', (line) => (
              setLogInlineFieldValue(line, property.key, value)
            ));
          });
      });
    }
  });
}

function addLineDatetimePropertyMenu(
  options: AddLineEntityPropertyMenuOptions,
  property: CustomProperty,
): void {
  const current = readInlineFieldValue(options.rawLine, property.key);
  const scheduled = String(property.key || '').trim().toLocaleLowerCase() === 'scheduled';
  options.menu.addItem((item) => {
    item
      .setTitle(current ? `${property.label}: ${current}` : `${property.label} (create field)`)
      .setIcon(property.icon || 'calendar')
      .setSection(options.section || 'tps-line-properties')
      .onClick(() => {
        const timeEstimate = Number.parseInt(
          readInlineFieldValue(options.rawLine, 'timeEstimate') || '0',
          10,
        ) || 0;
        const allDay = /^true$/iu.test(readInlineFieldValue(options.rawLine, 'allDay'));
        new ScheduledModal(
          options.app,
          current,
          timeEstimate,
          allDay,
          (result) => {
            runLineMutation(options, property, result.date ? 'set' : 'clear', (line) => {
              let next = setLogInlineFieldValue(line, property.key, result.date || null);
              if (scheduled) {
                next = setLogInlineFieldValue(
                  next,
                  'timeEstimate',
                  result.date ? String(result.timeEstimate || 0) : null,
                );
                next = setLogInlineFieldValue(
                  next,
                  'allDay',
                  result.date && result.allDay ? 'true' : null,
                );
              }
              return next;
            });
          },
          scheduled ? {} : {
            title: `Set ${property.label || property.key}`,
            fieldLabel: property.label || property.key,
            showTimeDetails: false,
          },
        ).open();
      });
  });
}

function addLineRecurrencePropertyMenu(
  options: AddLineEntityPropertyMenuOptions,
  property: CustomProperty,
): void {
  const current = readInlineFieldValue(options.rawLine, property.key);
  options.menu.addItem((item) => {
    item
      .setTitle(current ? `Edit ${property.label}…` : `${property.label} (create field)`)
      .setIcon(property.icon || 'repeat')
      .setSection(options.section || 'tps-line-properties')
      .onClick(() => {
        const scheduled = readInlineFieldValue(options.rawLine, 'scheduled');
        const startDate = scheduled ? new Date(scheduled.replace(' ', 'T')) : new Date();
        new RecurrenceModal(
          options.app,
          current,
          Number.isNaN(startDate.getTime()) ? new Date() : startDate,
          '',
          (rule) => {
            runLineMutation(options, property, rule ? 'set' : 'clear', (line) => (
              setLogInlineFieldValue(line, property.key, rule || null)
            ));
          },
          { showEndsOn: false },
        ).open();
      });
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
