import { App, ButtonComponent, Notice, PluginSettingTab, Setting, TextAreaComponent, TextComponent } from 'obsidian';
import type TPSGlobalContextMenuPlugin from './main';
import type { AppearanceSettingKey, CustomProperty, LinkedSubitemCheckboxMapping, ViewModeConditionOperator, ViewModeConditionType, ViewModeRule, ViewModeRuleCondition } from './types';
import { BucketSectionRenderer } from './notebook-navigator-settings/bucket-section';
import { HideSectionRenderer } from './notebook-navigator-settings/hide-section';
import { RulesSectionRenderer } from './notebook-navigator-settings/rules-section';
import type { BindCommittedText, SettingsSectionContext } from './notebook-navigator-settings/ui-common';
import { collectVaultPropertyOptions, getEffectivePropertyOptions, normalizeManualPropertyOptions } from './utils/property-options';
import {
  decodePropertyOptionSources,
  encodePropertyOptionSources,
  getPropertyOptionSources,
  isEntityOnlyProperty,
  propertyUsesEntityOptions,
  propertyUsesManualOptions,
  propertyUsesVaultOptions,
} from './utils/property-option-source';
import {
  applyAcceptedKindSetting,
  normalizeAcceptedKindSetting,
} from './utils/property-option-setting';
import { normalizeAcceptsKind } from './utils/entity-property';
import {
  createUniquePropertyKey,
  getPropertyKeyDiagnostic,
} from './utils/property-key-identity';
import {
  DEFAULT_LINKED_SUBITEM_MAPPINGS,
  mergeLinkedSubitemMappingPresentation,
  normalizeLinkedSubitemCheckboxState,
  normalizeLinkedSubitemMappings,
  parseLinkedSubitemMappingsText,
} from './utils/linked-subitem-mapping';
import { normalizeParentLinkFormat } from './handlers/parent-link-format';
import { FileSuggestModal } from './modals/FileSuggestModal';
import * as logger from './logger';
import { runDailyNoteHomeSettingTransaction } from './services/daily-note-home-setting-transaction';
import {
  normalizeNativeRecordLayout,
  normalizeNativeRecordRoot,
  normalizeNativeRecordStorageProfile,
} from './services/native-record-service';
import { importHealthPropertyCatalog } from './integrations/health-property-import';
import { installTaskRecordProperties } from './integrations/task-property-install';
import {
  BASE_QUERY_GUIDE_GOTCHAS,
  BASE_QUERY_GUIDE_SECTIONS,
  CURRENT_DAILY_NOTE_FEED_QUERY,
  OBSIDIAN_BASES_FUNCTIONS_URL,
  OBSIDIAN_BASES_SYNTAX_URL,
} from './base-query-guide';
import { normalizeDailyNavDayCount } from './utils/daily-note-nav-days';

const NN_TEXT_COMMIT_DEBOUNCE_MS = 300;
export const LEGACY_GCM_NOTEBOOK_NAVIGATOR_RULE_SETTINGS_STYLE_ID = 'tps-gcm-notebook-navigator-rule-settings-style';

export function removeLegacyNotebookNavigatorRuleSettingsStyle(ownerDocument: Document = document): void {
  ownerDocument.getElementById(LEGACY_GCM_NOTEBOOK_NAVIGATOR_RULE_SETTINGS_STYLE_ID)?.remove();
}

function formatAcceptedKindConstraint(value: unknown): string {
  const kinds = normalizeAcceptsKind(value);
  const formatted = kinds.map((kind) => `"${kind}"`);
  if (formatted.length === 0) return 'the configured Kinds';
  if (formatted.length === 1) return `Kind ${formatted[0]}`;
  return `Kinds ${formatted.slice(0, -1).join(', ')} or ${formatted[formatted.length - 1]}`;
}

type SettingsPageId = 'rules-fields' | 'menus-surfaces' | 'workflows' | 'appearance' | 'advanced';
type RulesFieldsPageId = 'frontmatter' | 'custom-fields' | 'view-mode';
type FrontmatterEditorId = 'sort' | 'tags' | 'icon-color';
type WorkflowPageId = 'home-daily' | 'tasks' | 'child-notes' | 'recurrence' | 'time-tracking';

interface SettingsRouteOption<T extends string> {
  id: T;
  label: string;
  description?: string;
  summary?: string;
}

const createCollapsibleSection = (
  parent: HTMLElement,
  title: string,
  description?: string,
  defaultOpen = false
): HTMLElement => {
  const details = parent.createEl('details', { cls: 'tps-collapsible-section' });
  if (defaultOpen) {
    details.setAttr('open', 'true');
  }

  const summary = details.createEl('summary', { cls: 'tps-collapsible-section-summary' });
  summary.createSpan({ cls: 'tps-collapsible-section-title', text: title });

  if (description) {
    details.createEl('p', {
      cls: 'tps-collapsible-section-description',
      text: description
    });
  }

  return details.createDiv({ cls: 'tps-collapsible-section-content' });
};

/**
 * Settings tab for the plugin
 */
export class TPSGlobalContextMenuSettingTab extends PluginSettingTab {
  plugin: TPSGlobalContextMenuPlugin;
  private static readonly SETTINGS_BUILD_STAMP = '2026-03-11 18:12';
  private readonly sectionState = new Map<string, boolean>();
  private activeSettingsPage: SettingsPageId = 'rules-fields';
  private activeRulesFieldsPage: RulesFieldsPageId = 'frontmatter';
  private activeFrontmatterEditor: FrontmatterEditorId = 'sort';
  private activeWorkflowPage: WorkflowPageId = 'home-daily';
  private activeBaseQuerySection = BASE_QUERY_GUIDE_SECTIONS[0]?.title || '';
  private readonly nnTextCommitTimers = new Map<string, number>();
  private dailyNoteHomeToggleGeneration = 0;

  constructor(app: App, plugin: TPSGlobalContextMenuPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private getSectionStateKey(parent: HTMLElement, title: string): string {
    const route = parent.closest<HTMLElement>('[data-tps-settings-route]')?.dataset.tpsSettingsRoute || 'settings';
    return `${route}::${title.trim()}`;
  }

  private createTrackedSection(
    parent: HTMLElement,
    title: string,
    description?: string,
    defaultOpen = false
  ): HTMLElement {
    const key = this.getSectionStateKey(parent, title);
    const content = createCollapsibleSection(
      parent,
      title,
      description,
      this.sectionState.get(key) ?? defaultOpen
    );
    const details = content.parentElement as HTMLDetailsElement | null;
    if (details) {
      this.sectionState.set(key, details.open);
      details.addEventListener('toggle', () => {
        this.sectionState.set(key, details.open);
      });
    }
    return content;
  }

  private createSettingsPage(
    parent: HTMLElement,
    route: SettingsPageId,
    title: string,
    description: string,
  ): HTMLElement {
    const page = parent.createDiv({ cls: 'tps-gcm-settings-page' });
    page.dataset.tpsSettingsRoute = route;
    const heading = page.createEl('h3', { text: title });
    heading.setAttr('tabindex', '-1');
    page.createEl('p', { text: description, cls: 'setting-item-description' });
    return page;
  }

  private focusRouteButton(route: string): void {
    const button = Array.from(
      this.containerEl.querySelectorAll<HTMLButtonElement>('.tps-gcm-settings-route-button'),
    ).find((candidate) => candidate.dataset.tpsSettingsRoute === route);
    button?.focus({ preventScroll: true });
  }

  private navigateToSettingsPage(route: SettingsPageId): void {
    this.activeSettingsPage = route;
    this.display();
    this.containerEl
      .querySelector<HTMLElement>('.tps-gcm-settings-page > h3')
      ?.focus({ preventScroll: false });
  }

  private redisplayPreservingRouteFocus(route: string): void {
    const scrollTop = this.containerEl.scrollTop;
    this.display();
    this.containerEl.scrollTop = scrollTop;
    this.focusRouteButton(route);
  }

  private renderRouteButtons<T extends string>(
    parent: HTMLElement,
    options: SettingsRouteOption<T>[],
    activeId: T,
    onSelect: (id: T) => void,
    className: string,
    ariaLabel: string,
  ): void {
    const nav = parent.createDiv({ cls: className });
    nav.setAttr('role', 'group');
    nav.setAttr('aria-label', ariaLabel);

    options.forEach((option) => {
      const button = nav.createEl('button', { cls: 'tps-gcm-settings-route-button' });
      button.type = 'button';
      button.dataset.tpsSettingsRoute = option.id;
      button.setAttr('aria-pressed', option.id === activeId ? 'true' : 'false');
      button.createSpan({ cls: 'tps-gcm-settings-route-title', text: option.label });
      if (option.summary) {
        button.createSpan({ cls: 'tps-gcm-settings-route-summary', text: option.summary });
      }
      if (option.description) {
        button.createSpan({ cls: 'tps-gcm-settings-route-description', text: option.description });
      }
      button.addEventListener('click', () => {
        if (option.id === activeId) return;
        onSelect(option.id);
      });
    });
  }

  private renderSettingsHub(container: HTMLElement): void {
    const settings = this.plugin.settings;
    const frontmatterRules = settings.notebookNavigatorRules;
    const ruleCount = frontmatterRules.smartSort.buckets.length
      + frontmatterRules.hideRules.length
      + frontmatterRules.rules.length;
    const enabledWorkflowCount = [
      settings.enableDailyNoteNav,
      settings.reconcileTaskStatusToCheckbox,
      settings.enableLinkedSubitemCheckboxes,
      settings.enableRecurrence,
      settings.enableTimeTracking,
    ].filter(Boolean).length;

    container.createEl('h3', { text: 'Choose what to configure', cls: 'tps-gcm-settings-hub-heading' });
    container.createEl('p', {
      text: 'Choose one area. Only that page is shown, so rule editors stay easy to find without loading every advanced option at once.',
      cls: 'setting-item-description',
    });

    this.renderRouteButtons<SettingsPageId>(
      container,
      [
        {
          id: 'rules-fields',
          label: 'Rules & fields',
          summary: `${ruleCount} rules · ${(settings.properties || []).length} fields`,
          description: 'Frontmatter rules, custom fields, and view-mode rules.',
        },
        {
          id: 'menus-surfaces',
          label: 'Menus & surfaces',
          summary: settings.enableInlinePersistentMenus ? 'Inline menu on' : 'Inline menu off',
          description: 'Right-click placement, linked context, note navigation, and inline UI.',
        },
        {
          id: 'workflows',
          label: 'Workflows',
          summary: `${enabledWorkflowCount} core features on`,
          description: 'Daily notes, tasks, child notes, recurrence, and time tracking.',
        },
        {
          id: 'appearance',
          label: 'Appearance',
          summary: 'Sizing & placement',
          description: 'Menu, navigation, and modal dimensions.',
        },
        {
          id: 'advanced',
          label: 'Advanced',
          summary: settings.enableLogging ? 'Debug logging on' : 'Debug logging off',
          description: 'Diagnostics and the compact Base query reference.',
        },
      ],
      this.activeSettingsPage,
      (id) => {
        this.navigateToSettingsPage(id);
      },
      'tps-gcm-settings-hub',
      'TPS Global Context Menu settings pages',
    );
  }

  private renderRulesFieldsNavigation(container: HTMLElement): void {
    const rules = this.plugin.settings.notebookNavigatorRules;
    this.renderRouteButtons<RulesFieldsPageId>(
      container,
      [
        {
          id: 'frontmatter',
          label: 'Frontmatter rules',
          summary: `${rules.smartSort.buckets.length + rules.hideRules.length + rules.rules.length} configured`,
        },
        {
          id: 'custom-fields',
          label: 'Custom fields',
          summary: `${(this.plugin.settings.properties || []).length} configured`,
        },
        {
          id: 'view-mode',
          label: 'View mode',
          summary: `${(this.plugin.settings.viewModeRules || []).length} rules`,
        },
      ],
      this.activeRulesFieldsPage,
      (id) => {
        this.activeRulesFieldsPage = id;
        this.redisplayPreservingRouteFocus(id);
      },
      'tps-gcm-settings-subnav',
      'Rules and fields sections',
    );
  }

  private renderWorkflowNavigation(container: HTMLElement): void {
    this.renderRouteButtons<WorkflowPageId>(
      container,
      [
        { id: 'home-daily', label: 'Home & daily notes' },
        { id: 'tasks', label: 'Tasks' },
        { id: 'child-notes', label: 'Child notes' },
        { id: 'recurrence', label: 'Recurrence' },
        { id: 'time-tracking', label: 'Time tracking' },
      ],
      this.activeWorkflowPage,
      (id) => {
        this.activeWorkflowPage = id;
        this.redisplayPreservingRouteFocus(id);
      },
      'tps-gcm-settings-subnav tps-gcm-settings-subnav--workflow',
      'Workflow sections',
    );
  }

  private renderLinkedContextSettings(container: HTMLElement): void {
    container.createEl('h4', { text: 'Linked context' });
    container.createEl('p', {
      text: 'Show incoming-link excerpts and choose their stable source order.',
      cls: 'setting-item-description',
    });

    new Setting(container)
      .setName('Show linked context')
      .setDesc('Show read-only excerpts from notes that link to the current note. Heading links include their nested section; frontmatter links include the whole source note.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableLinkedContextPanel === true).onChange(async (value) => {
          this.plugin.settings.enableLinkedContextPanel = value;
          await this.plugin.saveSettings();
          this.plugin.persistentMenuManager.ensureMenus();
          this.display();
        })
      );

    new Setting(container)
      .setName('Linked context order')
      .setDesc('Sort source paths alphabetically while keeping excerpts from each source in document order. The chosen order remains stable while you interact with a card.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('source-asc', 'Source path A → Z')
          .addOption('source-desc', 'Source path Z → A')
          .setValue(this.plugin.settings.linkedContextSortOrder || 'source-asc')
          .onChange(async (value: 'source-asc' | 'source-desc') => {
            this.plugin.settings.linkedContextSortOrder = value;
            await this.plugin.saveSettings();
            this.plugin.persistentMenuManager.ensureMenus();
          })
      );

    if (this.plugin.settings.enableLinkedContextPanel === true) {
      new Setting(container)
        .setName('Linked context placement')
        .setDesc('Place the linked material directly below the note title or after the note body.')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('top', 'Below title')
            .addOption('bottom', 'Bottom of note')
            .setValue(this.plugin.settings.linkedContextPlacement || 'bottom')
            .onChange(async (value: 'top' | 'bottom') => {
              this.plugin.settings.linkedContextPlacement = value;
              await this.plugin.saveSettings();
              this.plugin.persistentMenuManager.ensureMenus();
            })
        );
      new Setting(container)
        .setName('Linked context activation')
        .setDesc('Choose what happens when a read-only source card is activated.')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('same-tab', 'Open source in same tab')
            .addOption('new-tab', 'Open source in new tab')
            .addOption('hover-preview', 'Show hover preview')
            .setValue(this.plugin.settings.linkedContextOpenBehavior || 'same-tab')
            .onChange(async (value: 'same-tab' | 'new-tab' | 'hover-preview') => {
              this.plugin.settings.linkedContextOpenBehavior = value;
              await this.plugin.saveSettings();
              this.plugin.persistentMenuManager.ensureMenus();
            })
        );
    }
  }

  private bindNotebookNavigatorCommittedText: BindCommittedText = (
    text: TextComponent,
    initialValue: string,
    commit: (value: string) => Promise<void>,
    refreshOnCommit = false,
    applyToActiveFileOnCommit = false
  ) => {
    let committedValue = initialValue ?? '';
    let draftValue = committedValue;
    const commitKey = `nn-text:${Math.random().toString(36).slice(2, 9)}`;

    const cancelTimer = () => {
      const existing = this.nnTextCommitTimers.get(commitKey);
      if (existing !== undefined) {
        window.clearTimeout(existing);
        this.nnTextCommitTimers.delete(commitKey);
      }
    };

    const commitNow = async () => {
      if (draftValue === committedValue) return;
      await commit(draftValue);
      committedValue = draftValue;
      await this.plugin.saveSettings();
      if (applyToActiveFileOnCommit) {
        await this.plugin.applyRulesToActiveFile(false);
      }
      if (refreshOnCommit) {
        this.display();
      }
    };

    text.setValue(committedValue);
    text.onChange((value) => {
      draftValue = value;
      cancelTimer();
      const timer = window.setTimeout(() => {
        this.nnTextCommitTimers.delete(commitKey);
        void commitNow();
      }, NN_TEXT_COMMIT_DEBOUNCE_MS);
      this.nnTextCommitTimers.set(commitKey, timer);
    });
    text.inputEl.addEventListener('blur', () => {
      cancelTimer();
      void commitNow();
    });
    text.inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        text.inputEl.blur();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelTimer();
        draftValue = committedValue;
        text.setValue(committedValue);
        text.inputEl.blur();
      }
    });
  };

  private async persistNotebookNavigatorRuleChange(applyActive = false): Promise<void> {
    await this.plugin.saveSettings();
    if (applyActive) {
      await this.plugin.applyRulesToActiveFile(false);
    }
  }

  private renderNotebookNavigatorRules(container: HTMLElement): void {
    const settings = this.plugin.settings.notebookNavigatorRules;
    const root = container.createDiv({ cls: 'tps-gcm-settings-editor-page' });
    root.dataset.tpsSettingsRoute = 'frontmatter-rules';

    new Setting(root)
      .setName('Enable rule application')
      .setDesc('Allow GCM to write configured frontmatter rule outputs to markdown files.')
      .addToggle((toggle) => toggle.setValue(settings.enabled).onChange(async (value) => {
        settings.enabled = value;
        await this.plugin.saveSettings();
        this.display();
      }));

    if (!settings.enabled) {
      root.createEl('p', {
        cls: 'tps-gcm-settings-callout',
        text: 'Rule application is off. You can still build and review rules below; turn it on when you are ready for GCM to write their outputs.',
      });
    }

    const overview = root.createDiv({ cls: 'tps-gcm-settings-frontmatter-rules-overview-grid' });
    this.renderRuleOverviewCard(overview, 'Sort', `${settings.smartSort.buckets.length} buckets`, settings.smartSort.enabled ? 'Writes ordered sort keys.' : 'Disabled');
    this.renderRuleOverviewCard(overview, 'Tags', `${settings.hideRules.length} rules`, settings.autoRemoveHiddenWhenNoMatch ? 'Managed tags auto-clean.' : 'Manual tags preserved.');
    this.renderRuleOverviewCard(overview, 'Icon + Color', `${settings.rules.length} rules`, 'First matching icon and color win.');

    this.renderRouteButtons<FrontmatterEditorId>(
      root,
      [
        { id: 'sort', label: 'Sort buckets', summary: `${settings.smartSort.buckets.length}` },
        { id: 'tags', label: 'Tag rules', summary: `${settings.hideRules.length}` },
        { id: 'icon-color', label: 'Icon + color', summary: `${settings.rules.length}` },
      ],
      this.activeFrontmatterEditor,
      (id) => {
        this.activeFrontmatterEditor = id;
        this.redisplayPreservingRouteFocus(id);
      },
      'tps-gcm-settings-subnav tps-gcm-settings-subnav--rule-kind',
      'Frontmatter rule editor',
    );

    const sectionContext: SettingsSectionContext = {
      plugin: this.plugin,
      bindCommittedText: this.bindNotebookNavigatorCommittedText,
      refresh: () => this.display(),
      persistRuleChange: (applyActive = false) => this.persistNotebookNavigatorRuleChange(applyActive),
    };

    if (this.activeFrontmatterEditor === 'sort') {
      new BucketSectionRenderer(sectionContext).render(root);
    } else if (this.activeFrontmatterEditor === 'tags') {
      new HideSectionRenderer(sectionContext).render(root);
    } else {
      new RulesSectionRenderer(sectionContext).render(root);
    }

    const advanced = this.createTrackedSection(
      root,
      'Advanced rule settings',
      'Automatic triggers, output field names, cleanup, exclusions, and general frontmatter writes.',
      false,
    );

    new Setting(advanced)
      .setName('Auto-apply on file open')
      .setDesc('Evaluate and apply rules when a markdown file becomes active.')
      .addToggle((toggle) => toggle.setValue(settings.autoApplyOnFileOpen).onChange(async (value) => {
        settings.autoApplyOnFileOpen = value;
        await this.plugin.saveSettings();
      }));

    new Setting(advanced)
      .setName('Auto-apply on metadata change')
      .setDesc('Evaluate and apply rules after frontmatter changes.')
      .addToggle((toggle) => toggle.setValue(settings.autoApplyOnMetadataChange).onChange(async (value) => {
        settings.autoApplyOnMetadataChange = value;
        await this.plugin.saveSettings();
      }));

    new Setting(advanced)
      .setName('Startup vault scan')
      .setDesc('Scan markdown files once after startup.')
      .addToggle((toggle) => toggle.setValue(settings.applyOnStartup).onChange(async (value) => {
        settings.applyOnStartup = value;
        await this.plugin.saveSettings();
      }));

    new Setting(advanced)
      .setName('Metadata debounce (ms)')
      .setDesc('Debounce for metadata-change rule application.')
      .addText((text) => {
        text.setPlaceholder('350');
        this.bindNotebookNavigatorCommittedText(text, String(settings.metadataDebounceMs), async (value) => {
          const parsed = Number.parseInt(value, 10);
          settings.metadataDebounceMs = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 5000)) : 350;
        });
      });

    new Setting(advanced)
      .setName('Manual apply')
      .setDesc('Apply configured frontmatter rules immediately through GCM.')
      .addButton((button) => button.setButtonText('Active file').onClick(async () => {
        await this.plugin.applyRulesToActiveFile(true);
      }))
      .addButton((button) => button.setButtonText('All markdown files').onClick(async () => {
        await this.plugin.applyRulesToAllFiles(false);
      }));

    const preview = this.plugin.getRulePreviewForActiveFile?.();
    const previewText = preview
      ? [
        `Active file: ${String(preview.filePath || '')}`,
        `Icon: ${preview.icon ? `${String(preview.iconField)} = ${String(preview.icon)}` : '(no matching icon rule)'}`,
        `Color: ${preview.color ? `${String(preview.colorField)} = ${String(preview.color)}` : '(no matching color rule)'}`,
        `Sort: ${preview.sortKey ? `${String(preview.sortField)} = ${String(preview.sortKey)}${preview.sortMatched === false ? ' (no bucket matched)' : ''}` : '(not written)'}`,
        `Tags: +${(preview.tagsAdded as string[] | undefined)?.join(', ') || 'none'} / -${(preview.tagsRemoved as string[] | undefined)?.join(', ') || 'none'}`,
      ].join('\n')
      : 'Active file preview unavailable. Open a markdown note to inspect rule outputs.';
    const previewBox = advanced.createEl('pre', {
      cls: 'tps-gcm-settings-frontmatter-rules-preview',
      text: previewText,
    });
    previewBox.setAttr('aria-label', 'Active file rule output preview');

    new Setting(advanced)
      .setName('Icon field')
      .setDesc('Frontmatter key GCM uses to store icon value.')
      .addText((text) => {
        text.setPlaceholder('icon');
        this.bindNotebookNavigatorCommittedText(text, settings.frontmatterIconField, async (value) => {
          settings.frontmatterIconField = value.trim().replace(/\s+/g, '') || 'icon';
        }, false, true);
      });

    new Setting(advanced)
      .setName('Color field')
      .setDesc('Frontmatter key GCM uses to store color value.')
      .addText((text) => {
        text.setPlaceholder('color');
        this.bindNotebookNavigatorCommittedText(text, settings.frontmatterColorField, async (value) => {
          settings.frontmatterColorField = value.trim().replace(/\s+/g, '') || 'color';
        }, false, true);
      });

    new Setting(advanced)
      .setName('Clear icon when no match')
      .setDesc('Remove the icon field when no icon rule matches.')
      .addToggle((toggle) => toggle.setValue(settings.clearIconWhenNoMatch).onChange(async (value) => {
        settings.clearIconWhenNoMatch = value;
        await this.plugin.saveSettings();
        await this.plugin.applyRulesToActiveFile(false);
      }));

    new Setting(advanced)
      .setName('Clear color when no match')
      .setDesc('Remove the color field when no color rule matches.')
      .addToggle((toggle) => toggle.setValue(settings.clearColorWhenNoMatch).onChange(async (value) => {
        settings.clearColorWhenNoMatch = value;
        await this.plugin.saveSettings();
        await this.plugin.applyRulesToActiveFile(false);
      }));

    new Setting(advanced)
      .setName('Rule write exclusions')
      .setDesc('Skip icon/color/sort/tag rule writes for matching files. One pattern per line; supports exact paths, folder prefixes, wildcards (*), name:<basename>, and re:<regex>.')
      .addTextArea((text) => {
        text
          .setValue(settings.frontmatterWriteExclusions || '')
          .setPlaceholder('System/Templates/\nSystem/*\nname:daily-template\nre:^System/')
          .onChange(async (value) => {
            settings.frontmatterWriteExclusions = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(advanced)
      .setName('Auto-sync title from filename')
      .setDesc('Keep ordinary note titles aligned to filenames on create/open/rename. Daily Notes keep their template or user title and retain the canonical Daily Notes filename.')
      .addToggle(t => t.setValue(this.plugin.settings.autoSyncTitleFromFilename).onChange(async v => { this.plugin.settings.autoSyncTitleFromFilename = v; await this.plugin.saveSettings(); }));
    new Setting(advanced)
      .setName('Sync folderPath frontmatter')
      .setDesc('Write the note\'s current folder to `folderPath` during create/open/move flows.')
      .addToggle(t => t.setValue(this.plugin.settings.autoSaveFolderPath).onChange(async v => { this.plugin.settings.autoSaveFolderPath = v; await this.plugin.saveSettings(); }));
    new Setting(advanced)
      .setName('Auto-sync file timestamps')
      .setDesc('Keep created/modified timestamps on note frontmatter and task lines.')
      .addToggle(t => t.setValue(this.plugin.settings.autoSyncFileTimestamps).onChange(async v => { this.plugin.settings.autoSyncFileTimestamps = v; await this.plugin.saveSettings(); }));
    new Setting(advanced)
      .setName('Created timestamp key')
      .setDesc('Frontmatter key used for the file creation timestamp.')
      .addText(t => t
        .setValue(this.plugin.settings.dateCreatedFrontmatterKey || 'datecreated')
        .setPlaceholder('datecreated')
        .onChange(async v => {
          this.plugin.settings.dateCreatedFrontmatterKey = String(v || '').trim() || 'datecreated';
          await this.plugin.saveSettings();
        }));
    new Setting(advanced)
      .setName('Modified timestamp key')
      .setDesc('Frontmatter key used for the file modified timestamp.')
      .addText(t => t
        .setValue(this.plugin.settings.dateModifiedFrontmatterKey || 'datemodified')
        .setPlaceholder('datemodified')
        .onChange(async v => {
          this.plugin.settings.dateModifiedFrontmatterKey = String(v || '').trim() || 'datemodified';
          await this.plugin.saveSettings();
        }));
    new Setting(advanced)
      .setName('Timestamp format')
      .setDesc('Moment.js format used for created/modified timestamp values.')
      .addText(t => t
        .setValue(this.plugin.settings.fileTimestampFormat || 'YYYY-MM-DD HH:mm:ss')
        .setPlaceholder('YYYY-MM-DD HH:mm:ss')
        .onChange(async v => {
          this.plugin.settings.fileTimestampFormat = String(v || '').trim() || 'YYYY-MM-DD HH:mm:ss';
          await this.plugin.saveSettings();
        }));
    new Setting(advanced)
      .setName('Apply rules on subitem create')
      .setDesc('Immediately apply configured frontmatter rules after GCM creates a subitem.')
      .addToggle(t => t.setValue(this.plugin.settings.applyNotebookNavigatorRulesOnSubitemCreate).onChange(async v => { this.plugin.settings.applyNotebookNavigatorRulesOnSubitemCreate = v; await this.plugin.saveSettings(); }));
    new Setting(advanced)
      .setName('Global auto-write exclusions')
      .setDesc('Skip non-rule automatic frontmatter writes such as title, folderPath, timestamps, and daily-note repairs.')
      .addTextArea(t => t
        .setValue(this.plugin.settings.frontmatterAutoWriteExclusions || '')
        .setPlaceholder('Templates/\nTemplates/*.md\nname:daily-template')
        .onChange(async v => {
          this.plugin.settings.frontmatterAutoWriteExclusions = v;
          await this.plugin.saveSettings();
        }));
  }

  private renderRuleOverviewCard(container: HTMLElement, title: string, count: string, description: string): void {
    const card = container.createDiv({ cls: 'tps-gcm-settings-frontmatter-rules-overview-card' });
    const titleRow = card.createDiv({ cls: 'tps-gcm-settings-frontmatter-rules-overview-title' });
    titleRow.createSpan({ text: title });
    titleRow.createSpan({ cls: 'tps-gcm-settings-frontmatter-rules-overview-count', text: count });
    card.createDiv({ cls: 'tps-gcm-settings-frontmatter-rules-overview-desc', text: description });
  }

  private getWorkspaceNames(): string[] {
    const internal = (this.app as any).internalPlugins;
    if (!internal) return [];
    const wp = internal.plugins?.['workspaces'] ?? internal.getPluginById?.('workspaces');
    if (!wp || wp.enabled === false) return [];
    const instance = wp.instance;
    if (!instance) return [];
    const workspaces: Record<string, unknown> = instance.workspaces ?? {};
    return Object.keys(workspaces).sort();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const saveAppearance = async () => {
      await this.plugin.saveSettings();
    };

    const setAppearanceSettingValue = async (key: AppearanceSettingKey, value: unknown) => {
      (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
      await this.plugin.saveSettings();
    };

    // Appearance sync mode is handled by TPS-Controller.
    const getAppearanceModeText = (_key: AppearanceSettingKey): string => 'Sync handled by TPS-Controller.';
    const attachAppearanceSyncToggle = (_setting: Setting, _key: AppearanceSettingKey) => { };

    const pluginsRegistry = (this.app as any)?.plugins;
    const hasController = Boolean(
      pluginsRegistry?.getPlugin?.('tps-controller') || pluginsRegistry?.plugins?.['tps-controller']
    );
    containerEl.createEl('h2', { text: `TPS Global Context Menu (${TPSGlobalContextMenuSettingTab.SETTINGS_BUILD_STAMP})` });

    containerEl.createEl('p', {
      text: 'Define a single context menu that can be reused throughout the vault. Menu items accept JSON definitions to keep the configuration portable and extendable.',
    });

    if (hasController) {
      const ownershipNote = containerEl.createDiv({ cls: 'setting-item-description' });
      ownershipNote.style.marginBottom = '16px';
      ownershipNote.style.padding = '10px 12px';
      ownershipNote.style.border = '1px solid var(--background-modifier-border)';
      ownershipNote.style.borderRadius = '8px';
      ownershipNote.style.background = 'var(--background-secondary)';
      ownershipNote.setText(
        [
          hasController ? 'TPS Controller owns orchestration and runtime scheduling.' : '',
          'GCM owns shared TPS concepts, contracts, event helpers, menu behavior, note interaction, and frontmatter rule semantics.'
        ].filter(Boolean).join(' ')
      );
    }

    this.renderSettingsHub(containerEl);

    const activePage = this.activeSettingsPage === 'rules-fields'
      ? this.createSettingsPage(containerEl, 'rules-fields', 'Rules & fields', 'Configure frontmatter automation, reusable custom fields, and view-mode rules.')
      : this.activeSettingsPage === 'menus-surfaces'
        ? this.createSettingsPage(containerEl, 'menus-surfaces', 'Menus & surfaces', 'Choose where GCM appears and how note links and inline controls behave.')
        : this.activeSettingsPage === 'workflows'
          ? this.createSettingsPage(containerEl, 'workflows', 'Workflows', 'Configure one note-interaction workflow at a time.')
          : this.activeSettingsPage === 'appearance'
            ? this.createSettingsPage(containerEl, 'appearance', 'Appearance', 'Tune menu, navigation, and modal sizing without changing behavior.')
            : this.createSettingsPage(containerEl, 'advanced', 'Advanced', 'Troubleshooting and Base query reference material.');

    if (this.activeSettingsPage === 'rules-fields') {
      this.renderRulesFieldsNavigation(activePage);
      if (this.activeRulesFieldsPage === 'frontmatter') {
        this.renderNotebookNavigatorRules(activePage);
      }
    }

    if (this.activeSettingsPage === 'menus-surfaces') {
      new Setting(activePage)
        .setName('Right-click menu placement')
        .setDesc('Choose whether TPS items appear before or after native/core menu items.')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('tps-last', 'TPS after native')
            .addOption('tps-first', 'TPS before native')
            .setValue(this.plugin.settings.nativeMenuPlacement || 'tps-last')
            .onChange(async (value: 'tps-first' | 'tps-last') => {
              this.plugin.settings.nativeMenuPlacement = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(activePage)
        .setName('Force previews for Base links')
        .setDesc('Open note links in Calendar, Kanban, TPS List, and TPS Table as a preview on first click and the note on second click.')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.enableBasesForcedLinkPreview === true)
            .onChange(async (value) => {
              this.plugin.settings.enableBasesForcedLinkPreview = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(activePage)
        .setName('Enable in specific views')
        .setDesc('Live Preview/editor, Reading View/popovers, and side panels, in that order.')
        .addToggle(toggle => toggle
          .setTooltip('Live Preview & Editor')
          .setValue(this.plugin.settings.enableInLivePreview)
          .onChange(async v => { this.plugin.settings.enableInLivePreview = v; await this.plugin.saveSettings(); }))
        .addToggle(toggle => toggle
          .setTooltip('Reading View & Popovers')
          .setValue(this.plugin.settings.enableInPreview)
          .onChange(async v => { this.plugin.settings.enableInPreview = v; await this.plugin.saveSettings(); }))
        .addToggle(toggle => toggle
          .setTooltip('Side Panels (Explorer, etc)')
          .setValue(this.plugin.settings.enableInSidePanels)
          .onChange(async v => { this.plugin.settings.enableInSidePanels = v; await this.plugin.saveSettings(); }));

      new Setting(activePage)
        .setName('Show inline context menu')
        .setDesc('Master toggle for the persistent inline bar, title icon, and parent navigation.')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.enableInlinePersistentMenus).onChange(async (value) => {
            this.plugin.settings.enableInlinePersistentMenus = value;
            await this.plugin.saveSettings();
            this.display();
          }),
        );

      this.renderLinkedContextSettings(activePage);

      activePage.createEl('h4', { text: 'Note navigation' });
      activePage.createEl('p', {
        text: 'Choose which note-navigation shortcuts appear and where they are placed.',
        cls: 'setting-item-description',
      });

      new Setting(activePage)
        .setName('Show note navigation')
        .setDesc('Show note-navigation controls below the title or in the bottom note toolbar.')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.enableTopParentNav === true).onChange(async (value) => {
            this.plugin.settings.enableTopParentNav = value;
            await this.plugin.saveSettings();
            this.plugin.persistentMenuManager.ensureMenus();
          }),
        );

      new Setting(activePage)
        .setName('Navigation placement')
        .setDesc('Place note-navigation controls below the title or in the bottom note toolbar.')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('top', 'Below title')
            .addOption('bottom', 'Bottom toolbar')
            .setValue(this.plugin.settings.topParentNavPlacement || 'top')
            .onChange(async (value: 'top' | 'bottom') => {
              this.plugin.settings.topParentNavPlacement = value;
              await this.plugin.saveSettings();
              this.plugin.persistentMenuManager.ensureMenus();
            }),
        );

      new Setting(activePage)
        .setName('Show Calendar button')
        .setDesc('Show the Calendar popover shortcut for scheduled notes. The separate Daily Note shortcut stays available.')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.showCalendarNavButton !== false).onChange(async (value) => {
            this.plugin.settings.showCalendarNavButton = value;
            await this.plugin.saveSettings();
            this.plugin.persistentMenuManager.ensureMenus();
          }),
        );

      new Setting(activePage)
        .setName('Show Tasks button')
        .setDesc('Show the task-list shortcut for the current note.')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.showTasksNavButton !== false).onChange(async (value) => {
            this.plugin.settings.showTasksNavButton = value;
            await this.plugin.saveSettings();
            this.plugin.persistentMenuManager.ensureMenus();
          }),
        );

      new Setting(activePage)
        .setName('Show Mentions button')
        .setDesc('Show the links-and-mentions shortcut for the current note.')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.showMentionsNavButton !== false).onChange(async (value) => {
            this.plugin.settings.showMentionsNavButton = value;
            await this.plugin.saveSettings();
            this.plugin.persistentMenuManager.ensureMenus();
          }),
        );

      if (this.plugin.settings.enableInlinePersistentMenus) {
        new Setting(activePage)
          .setName('Inline menu only')
          .setDesc('Disable TPS additions in native/right-click menus and keep only inline persistent surfaces.')
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.inlineMenuOnly).onChange(async (value) => {
              this.plugin.settings.inlineMenuOnly = value;
              await this.plugin.saveSettings();
            }),
          );
      }
    }

    // --- Appearance Settings ---
    if (this.activeSettingsPage === 'appearance') {
      const appearance = activePage;
      appearance.createEl('p', {
        text: 'Appearance values sync through TPS Controller when it is available.',
        cls: 'setting-item-description',
      });

    const menuTextScaleSetting = new Setting(appearance)
      .setName('Menu text scale')
      .setDesc(`Scale for inline menu and panel text. ${getAppearanceModeText('menuTextScale')}`)
      .addSlider((slider) =>
        slider
          .setLimits(70, 180, 5)
          .setDynamicTooltip()
          .setValue(Math.round((this.plugin.settings.menuTextScale || 1) * 100))
          .onChange(async (value) => {
            setAppearanceSettingValue('menuTextScale', value / 100);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(menuTextScaleSetting, 'menuTextScale');

    const buttonScaleSetting = new Setting(appearance)
      .setName('Button size scale')
      .setDesc(`Scale action buttons, collapse buttons, and nav buttons. ${getAppearanceModeText('buttonScale')}`)
      .addSlider((slider) =>
        slider
          .setLimits(70, 180, 5)
          .setDynamicTooltip()
          .setValue(Math.round((this.plugin.settings.buttonScale || 1) * 100))
          .onChange(async (value) => {
            setAppearanceSettingValue('buttonScale', value / 100);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(buttonScaleSetting, 'buttonScale');

    const controlScaleSetting = new Setting(appearance)
      .setName('Selector/input size scale')
      .setDesc(`Scale selector/input controls (dropdowns, text/date inputs, quick inputs). ${getAppearanceModeText('controlScale')}`)
      .addSlider((slider) =>
        slider
          .setLimits(70, 180, 5)
          .setDynamicTooltip()
          .setValue(Math.round((this.plugin.settings.controlScale || 1) * 100))
          .onChange(async (value) => {
            setAppearanceSettingValue('controlScale', value / 100);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(controlScaleSetting, 'controlScale');

    const densitySetting = new Setting(appearance)
      .setName('Menu density')
      .setDesc(`Adjust spacing/padding density across chips, rows, and action buttons. ${getAppearanceModeText('menuDensity')}`)
      .addSlider((slider) =>
        slider
          .setLimits(75, 135, 5)
          .setDynamicTooltip()
          .setValue(Math.round((this.plugin.settings.menuDensity || 1) * 100))
          .onChange(async (value) => {
            setAppearanceSettingValue('menuDensity', value / 100);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(densitySetting, 'menuDensity');

    const radiusSetting = new Setting(appearance)
      .setName('Corner roundness')
      .setDesc(`Scale corner radius for chips, icon buttons, and collapsed controls. ${getAppearanceModeText('menuRadiusScale')}`)
      .addSlider((slider) =>
        slider
          .setLimits(60, 180, 5)
          .setDynamicTooltip()
          .setValue(Math.round((this.plugin.settings.menuRadiusScale || 1) * 100))
          .onChange(async (value) => {
            setAppearanceSettingValue('menuRadiusScale', value / 100);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(radiusSetting, 'menuRadiusScale');

    const livePositionSetting = new Setting(appearance)
      .setName('Live menu position')
      .setDesc(`Horizontal anchor for the floating Live Preview bar. ${getAppearanceModeText('liveMenuPosition')}`)
      .addDropdown((dropdown) =>
        dropdown
          .addOption('center', 'Center')
          .addOption('left', 'Left')
          .addOption('right', 'Right')
          .setValue(this.plugin.settings.liveMenuPosition || 'center')
          .onChange(async (value: 'left' | 'center' | 'right') => {
            setAppearanceSettingValue('liveMenuPosition', value);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(livePositionSetting, 'liveMenuPosition');

    const liveOffsetXSetting = new Setting(appearance)
      .setName('Live menu horizontal offset')
      .setDesc(`X offset (px) applied after positioning. Negative = left, positive = right. ${getAppearanceModeText('liveMenuOffsetX')}`)
      .addSlider((slider) =>
        slider
          .setLimits(-300, 300, 5)
          .setDynamicTooltip()
          .setValue(Math.round(this.plugin.settings.liveMenuOffsetX || 0))
          .onChange(async (value) => {
            setAppearanceSettingValue('liveMenuOffsetX', value);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(liveOffsetXSetting, 'liveMenuOffsetX');

    const liveOffsetYSetting = new Setting(appearance)
      .setName('Live menu vertical offset')
      .setDesc(`Y offset (px) applied after positioning. Negative = up, positive = down. ${getAppearanceModeText('liveMenuOffsetY')}`)
      .addSlider((slider) =>
        slider
          .setLimits(-240, 240, 4)
          .setDynamicTooltip()
          .setValue(Math.round(this.plugin.settings.liveMenuOffsetY || 0))
          .onChange(async (value) => {
            setAppearanceSettingValue('liveMenuOffsetY', value);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(liveOffsetYSetting, 'liveMenuOffsetY');

    const subitemsMarginSetting = new Setting(appearance)
      .setName('Subitems panel margin bottom')
      .setDesc(`Vertical spacing (px) between the subitems panel and the context menu. ${getAppearanceModeText('subitemsMarginBottom')}`)
      .addSlider((slider) =>
        slider
          .setLimits(-20, 40, 1)
          .setDynamicTooltip()
          .setValue(Math.round(this.plugin.settings.subitemsMarginBottom ?? 0)) // Default 0
          .onChange(async (value) => {
            setAppearanceSettingValue('subitemsMarginBottom', value);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(subitemsMarginSetting, 'subitemsMarginBottom');

    appearance.createEl('h4', { text: 'Daily Note Navigation', attr: { style: 'margin-top: 1.2em;' } });

    const dailyNavScaleSetting = new Setting(appearance)
      .setName('Nav button size scale')
      .setDesc(`Scale the daily note navigation controls independently of the rest of the UI. ${getAppearanceModeText('dailyNavScale')}`)
      .addSlider((slider) =>
        slider
          .setLimits(50, 250, 5)
          .setDynamicTooltip()
          .setValue(Math.round((this.plugin.settings.dailyNavScale ?? 1) * 100))
          .onChange(async (value) => {
            setAppearanceSettingValue('dailyNavScale', value / 100);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(dailyNavScaleSetting, 'dailyNavScale');

    new Setting(appearance)
      .setName('Visible day buttons')
      .setDesc('Choose how many contiguous days the Daily Note navigator shows. Seven keeps the existing Monday-Sunday week; shorter ranges stay centered on the active day.')
      .addSlider((slider) =>
        slider
          .setLimits(1, 7, 1)
          .setDynamicTooltip()
          .setValue(normalizeDailyNavDayCount(this.plugin.settings.dailyNavDayCount))
          .onChange(async (value) => {
            this.plugin.settings.dailyNavDayCount = normalizeDailyNavDayCount(value);
            await this.plugin.saveSettings();
            this.plugin.dailyNoteNavManager?.refresh();
          }),
      );

    const dailyNavOpacitySetting = new Setting(appearance)
      .setName('Nav resting opacity')
      .setDesc(`Opacity of the floating nav when not hovered (0 = hidden until hover, 100 = always fully visible). ${getAppearanceModeText('dailyNavRestOpacity')}`)
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 5)
          .setDynamicTooltip()
          .setValue(Math.round(this.plugin.settings.dailyNavRestOpacity ?? 0))
          .onChange(async (value) => {
            setAppearanceSettingValue('dailyNavRestOpacity', value);
            await saveAppearance();
            // Update the data-rest-visible attribute on any live nav
            const navManager = (this.plugin as any).dailyNoteNavManager;
            if (navManager?.currentNav) {
              if (value > 0) {
                navManager.currentNav.dataset.restVisible = 'true';
              } else {
                delete navManager.currentNav.dataset.restVisible;
              }
            }
          }),
      );
    attachAppearanceSyncToggle(dailyNavOpacitySetting, 'dailyNavRestOpacity');

    const modalWidthSetting = new Setting(appearance)
      .setName('Modal width')
      .setDesc(`Width of TPS modal dialogs (Add Tag, Schedule, Recurrence, etc). ${getAppearanceModeText('modalWidth')}`)
      .addSlider((slider) =>
        slider
          .setLimits(320, 960, 20)
          .setDynamicTooltip()
          .setValue(Math.round(this.plugin.settings.modalWidth || 520))
          .onChange(async (value) => {
            setAppearanceSettingValue('modalWidth', value);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(modalWidthSetting, 'modalWidth');

    const modalHeightSetting = new Setting(appearance)
      .setName('Modal max height (vh)')
      .setDesc(`Maximum modal height as viewport percentage. ${getAppearanceModeText('modalMaxHeightVh')}`)
      .addSlider((slider) =>
        slider
          .setLimits(50, 95, 1)
          .setDynamicTooltip()
          .setValue(Math.round(this.plugin.settings.modalMaxHeightVh || 80))
          .onChange(async (value) => {
            setAppearanceSettingValue('modalMaxHeightVh', value);
            await saveAppearance();
          }),
      );
    attachAppearanceSyncToggle(modalHeightSetting, 'modalMaxHeightVh');

      new Setting(appearance)
        .setName('Reset appearance')
        .setDesc('Restore all appearance controls to default values.')
        .addButton((button) =>
          button
            .setButtonText('Reset')
            .onClick(async () => {
              setAppearanceSettingValue('menuTextScale', 1);
              setAppearanceSettingValue('buttonScale', 1);
              setAppearanceSettingValue('controlScale', 1);
              setAppearanceSettingValue('menuDensity', 1);
              setAppearanceSettingValue('menuRadiusScale', 1);
              setAppearanceSettingValue('liveMenuPosition', 'center');
              setAppearanceSettingValue('liveMenuOffsetX', 0);
              setAppearanceSettingValue('liveMenuOffsetY', 0);
              setAppearanceSettingValue('subitemsMarginBottom', 0);
              setAppearanceSettingValue('modalWidth', 520);
              setAppearanceSettingValue('modalMaxHeightVh', 80);
              await saveAppearance();
              this.display();
            }),
        );
    }


    // --- Custom Property Configuration ---
    if (this.activeSettingsPage === 'rules-fields' && this.activeRulesFieldsPage === 'custom-fields') {
      const propertyConfig = activePage.createDiv({ cls: 'tps-gcm-settings-editor-page' });
      propertyConfig.dataset.tpsSettingsRoute = 'custom-fields';

      new Setting(propertyConfig)
        .setName('Show custom fields in inline UI')
        .setDesc('Display configured custom fields in the inline header/context strip.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.showCustomPropertiesInInlineUi !== false)
          .onChange(async (value) => {
            this.plugin.settings.showCustomPropertiesInInlineUi = value;
            await this.plugin.saveSettings();
            this.plugin.persistentMenuManager.ensureMenus();
          }));

      new Setting(propertyConfig)
        .setName('Stack custom fields under title')
        .setDesc('Show configured inline fields as a stacked section under the note title instead of the bottom inline strip.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.showCustomPropertiesUnderTitle === true)
          .onChange(async (value) => {
            this.plugin.settings.showCustomPropertiesUnderTitle = value;
            await this.plugin.saveSettings();
            this.plugin.persistentMenuManager.ensureMenus();
          }));

      new Setting(propertyConfig)
        .setName('Default stacked fields closed')
        .setDesc('Newly opened notes start with the stacked Properties section collapsed.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.defaultStackedPropertiesClosed === true)
          .onChange(async (value) => {
            this.plugin.settings.defaultStackedPropertiesClosed = value;
            await this.plugin.saveSettings();
            this.plugin.persistentMenuManager.ensureMenus();
          }));

      new Setting(propertyConfig)
        .setName('Show custom fields in context menu')
        .setDesc('Display configured custom fields in the right-click context menu.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.showCustomPropertiesInContextMenu !== false)
          .onChange(async (value) => {
            this.plugin.settings.showCustomPropertiesInContextMenu = value;
            await this.plugin.saveSettings();
          }));

      new Setting(propertyConfig)
        .setName('Inherit Notebook Navigator tag colors')
        .setDesc('Let inline tag chips use Notebook Navigator tag colors when available.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.inheritNotebookNavigatorTagColors !== false)
          .onChange(async (value) => {
            this.plugin.settings.inheritNotebookNavigatorTagColors = value;
            await this.plugin.saveSettings();
          }));

      propertyConfig.createEl('h4', { text: 'Field definitions' });
      propertyConfig.createEl('p', {
        text: `${(this.plugin.settings.properties || []).length} fields configured. Open one field to edit it.`,
        cls: 'setting-item-description',
      });

      const propertiesConfigContainer = propertyConfig.createDiv();
      this.renderProperties(propertiesConfigContainer);
      new Setting(propertyConfig)
        .addButton(btn => btn.setButtonText('Add field').setCta().onClick(async () => {
          const key = createUniquePropertyKey('new_prop', this.plugin.settings.properties);
          this.plugin.settings.properties.push({ id: Date.now().toString(), label: 'New Property', key, type: 'text' });
          await this.plugin.saveSettings();
          this.display();
        }));
    }

    // --- View Mode Settings ---
    if (this.activeSettingsPage === 'rules-fields' && this.activeRulesFieldsPage === 'view-mode') {
      const viewMode = activePage.createDiv({ cls: 'tps-gcm-settings-editor-page' });
      viewMode.dataset.tpsSettingsRoute = 'view-mode';
      const viewModeConfigContainer = viewMode.createDiv();
      const viewRulesPopout: HTMLElement = viewModeConfigContainer;

      new Setting(viewModeConfigContainer)
        .setName('Enable automatic view mode switching')
        .setDesc('Automatically switch between Source, Live Preview, and Reading modes based on the rules below.')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.enableViewModeSwitching)
            .onChange(async (value) => {
              this.plugin.settings.enableViewModeSwitching = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(viewModeConfigContainer)
        .setName('Show inline manual view mode controls')
        .setDesc('Show Reading, Live, and Source buttons in the inline menu panel.')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.enableInlineManualViewMode)
            .onChange(async (value) => {
              this.plugin.settings.enableInlineManualViewMode = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(viewModeConfigContainer)
        .setName('Frontmatter key')
        .setDesc('The frontmatter property used to determine view mode (e.g. "viewmode")')
        .addText((text) =>
          text
            .setValue(this.plugin.settings.viewModeFrontmatterKey)
            .setPlaceholder('viewmode')
            .onChange(async (value) => {
              this.plugin.settings.viewModeFrontmatterKey = value || 'viewmode';
              await this.plugin.saveSettings();
            })
        );

      new Setting(viewModeConfigContainer)
        .setName('Ignored folders')
        .setDesc('One path per line. Files in these folders will generally keep their current view mode.')
        .addTextArea((text) => {
          text
            .setPlaceholder('Bases\nAtlas/Views')
            .setValue(this.plugin.settings.viewModeIgnoredFolders || '')
            .onChange(async (value) => {
              this.plugin.settings.viewModeIgnoredFolders = value;
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 3;
          text.inputEl.cols = 30;
        });

      viewModeConfigContainer.createEl('h4', { text: 'View mode rules' });
      viewModeConfigContainer.createEl('p', {
        text: 'Define AND/OR conditions using frontmatter, path, schedule, or Daily Note date.',
        cls: 'setting-item-description',
      });

    const ensureViewModeRules = (): ViewModeRule[] => {
      if (!Array.isArray(this.plugin.settings.viewModeRules)) {
        this.plugin.settings.viewModeRules = [];
      }
      return this.plugin.settings.viewModeRules as ViewModeRule[];
    };

    const createCondition = (type: ViewModeConditionType): ViewModeRuleCondition => {
      if (type === 'path') return { type: 'path', operator: 'contains', value: '' };
      if (type === 'scheduled') return { type: 'scheduled', key: 'scheduled', operator: 'past' };
      if (type === 'daily-note') return { type: 'daily-note', operator: 'not-today' };
      return { type: 'frontmatter', key: 'status', operator: 'equals', value: '' };
    };

    const normalizeConditionType = (type: unknown): ViewModeConditionType => {
      const normalized = String(type || '').trim().toLowerCase();
      if (normalized === 'path') return 'path';
      if (normalized === 'scheduled') return 'scheduled';
      if (normalized === 'daily-note') return 'daily-note';
      return 'frontmatter';
    };

    const normalizeConditionOperator = (type: ViewModeConditionType, operator: unknown): ViewModeConditionOperator => {
      const value = String(operator || '').trim().toLowerCase();
      if (type === 'path') {
        if (value === 'equals' || value === 'starts-with' || value === 'ends-with' || value === 'not-contains' || value === 'exists' || value === 'missing') {
          return value as ViewModeConditionOperator;
        }
        return 'contains';
      }
      if (type === 'frontmatter') {
        if (value === 'contains' || value === 'not-equals' || value === 'not-contains' || value === 'exists' || value === 'missing' || value === 'is-empty') {
          return value as ViewModeConditionOperator;
        }
        return 'equals';
      }
      if (value === 'future' || value === 'today' || value === 'not-today' || value === 'exists' || value === 'missing') {
        return value as ViewModeConditionOperator;
      }
      return 'past';
    };

    const operatorNeedsValue = (type: ViewModeConditionType, operator: ViewModeConditionOperator): boolean => {
      if (type === 'daily-note' || type === 'scheduled') return false;
      return operator !== 'exists' && operator !== 'missing' && operator !== 'is-empty';
    };

    const ensureRuleShape = (rule: ViewModeRule): { normalizedRule: ViewModeRule; changed: boolean } => {
      let changed = false;
      const normalizedRule: ViewModeRule = rule;

      if (normalizedRule.match !== 'all' && normalizedRule.match !== 'any') {
        normalizedRule.match = 'all';
        changed = true;
      }
      if (!normalizedRule.mode) {
        normalizedRule.mode = 'reading';
        changed = true;
      }

      if (!Array.isArray(normalizedRule.conditions) || normalizedRule.conditions.length === 0) {
        const legacyKey = String((normalizedRule as any).key || '').trim();
        const legacyValue = String((normalizedRule as any).value || '').trim();
        if (legacyKey && legacyValue) {
          normalizedRule.conditions = [{ type: 'frontmatter', key: legacyKey, operator: 'equals', value: legacyValue }];
        } else {
          normalizedRule.conditions = [createCondition('frontmatter')];
        }
        changed = true;
      }

      normalizedRule.conditions = (normalizedRule.conditions || []).map((condition) => {
        const type = normalizeConditionType(condition?.type);
        const operator = normalizeConditionOperator(type, condition?.operator);
        const normalizedCondition: ViewModeRuleCondition = {
          ...condition,
          type,
          operator,
        };
        if (type === 'frontmatter' && !String(normalizedCondition.key || '').trim()) {
          normalizedCondition.key = 'status';
          changed = true;
        }
        if (type === 'scheduled' && !String(normalizedCondition.key || '').trim()) {
          normalizedCondition.key = 'scheduled';
          changed = true;
        }
        if (operatorNeedsValue(type, operator)) {
          if (normalizedCondition.value == null) {
            normalizedCondition.value = '';
            changed = true;
          }
        } else if (normalizedCondition.value) {
          normalizedCondition.value = '';
          changed = true;
        }
        return normalizedCondition;
      });

      return { normalizedRule, changed };
    };

    const getOperatorOptions = (type: ViewModeConditionType): Array<{ value: ViewModeConditionOperator; label: string }> => {
      if (type === 'path') {
        return [
          { value: 'contains', label: 'contains' },
          { value: 'equals', label: 'equals' },
          { value: 'starts-with', label: 'starts with' },
          { value: 'ends-with', label: 'ends with' },
          { value: 'not-contains', label: 'does not contain' },
          { value: 'exists', label: 'exists' },
          { value: 'missing', label: 'missing' },
        ];
      }
      if (type === 'frontmatter') {
        return [
          { value: 'equals', label: 'equals' },
          { value: 'contains', label: 'contains' },
          { value: 'not-equals', label: 'does not equal' },
          { value: 'not-contains', label: 'does not contain' },
          { value: 'exists', label: 'exists' },
          { value: 'missing', label: 'missing' },
        ];
      }
      return [
        { value: 'past', label: 'is in the past' },
        { value: 'future', label: 'is in the future' },
        { value: 'today', label: 'is today' },
        { value: 'not-today', label: 'is not today' },
        { value: 'exists', label: 'exists' },
        { value: 'missing', label: 'missing' },
      ];
    };

      new Setting(viewRulesPopout)
        .setName('Rules')
        .setDesc('Add and combine conditions per rule.')
        .addButton(btn => btn
          .setButtonText('Add Rule')
          .setCta()
          .onClick(async () => {
            const rules = ensureViewModeRules();
            rules.push({
              mode: 'reading',
              match: 'all',
              conditions: [createCondition('frontmatter')],
            });
            await this.plugin.saveSettings();
            this.display();
          }))
        .addButton(btn => btn
          .setButtonText('Add Daily Rule')
          .onClick(async () => {
            const rules = ensureViewModeRules();
            rules.push({
              mode: 'reading',
              match: 'all',
              conditions: [{ type: 'daily-note', operator: 'not-today' }],
            });
            await this.plugin.saveSettings();
            this.display();
          }))
        .addButton(btn => btn
          .setButtonText('Add Path/Past OR')
          .onClick(async () => {
            const rules = ensureViewModeRules();
            rules.push({
              mode: 'reading',
              match: 'any',
              conditions: [
                { type: 'path', operator: 'contains', value: '' },
                { type: 'scheduled', key: 'scheduled', operator: 'past' },
              ],
            });
            await this.plugin.saveSettings();
            this.display();
          }));

      const rules = ensureViewModeRules();
      let migratedRules = false;
      rules.forEach((rule, index) => {
        const normalized = ensureRuleShape(rule);
        if (normalized.changed) migratedRules = true;
        const currentRule = normalized.normalizedRule;

        const card = viewRulesPopout.createDiv({ cls: 'tps-gcm-viewmode-rule' });
        card.style.border = '1px solid var(--background-modifier-border)';
        card.style.borderRadius = '8px';
        card.style.padding = '10px';
        card.style.marginBottom = '10px';

        new Setting(card)
          .setName(`Rule ${index + 1}`)
          .setDesc('Conditions must match before applying mode.')
          .addDropdown(drop => drop
            .addOption('all', 'Match all (AND)')
            .addOption('any', 'Match any (OR)')
            .setValue(currentRule.match || 'all')
            .onChange(async v => {
              currentRule.match = v === 'any' ? 'any' : 'all';
              await this.plugin.saveSettings();
            }))
          .addDropdown(drop => drop
            .addOption('reading', 'Reading')
            .addOption('source', 'Source')
            .addOption('live', 'Live')
            .setValue(currentRule.mode)
            .onChange(async v => {
              currentRule.mode = v;
              await this.plugin.saveSettings();
            }))
          .addButton(btn => btn
            .setButtonText('Add Condition')
            .onClick(async () => {
              currentRule.conditions = currentRule.conditions || [];
              currentRule.conditions.push(createCondition('frontmatter'));
              await this.plugin.saveSettings();
              this.display();
            }))
          .addExtraButton(btn => btn
            .setIcon('trash')
            .setTooltip('Delete rule')
            .onClick(async () => {
              rules.splice(index, 1);
              await this.plugin.saveSettings();
              this.display();
            }));

        const conditions = currentRule.conditions || [];
        conditions.forEach((condition, conditionIndex) => {
          const type = normalizeConditionType(condition.type);
          const operator = normalizeConditionOperator(type, condition.operator);
          const conditionRow = card.createDiv({ cls: 'tps-gcm-viewmode-condition-row' });

          const typeSetting = new Setting(conditionRow).setClass('tps-gcm-no-border');
          typeSetting.addDropdown(drop => drop
            .addOption('frontmatter', 'Frontmatter')
            .addOption('path', 'Path')
            .addOption('scheduled', 'Scheduled')
            .addOption('daily-note', 'Daily Note')
            .setValue(type)
            .onChange(async v => {
              const nextType = normalizeConditionType(v);
              const nextCondition = createCondition(nextType);
              currentRule.conditions![conditionIndex] = nextCondition;
              await this.plugin.saveSettings();
              this.display();
            }));

          const keySetting = new Setting(conditionRow).setClass('tps-gcm-no-border');
          if (type === 'frontmatter' || type === 'scheduled') {
            keySetting.addText(text => text
              .setPlaceholder(type === 'frontmatter' ? 'key' : 'scheduled')
              .setValue(String(condition.key || (type === 'scheduled' ? 'scheduled' : '')))
              .onChange(async value => {
                condition.key = type === 'scheduled' ? (value.trim() || 'scheduled') : value.trim();
                await this.plugin.saveSettings();
              }));
          } else {
            keySetting.setName('');
          }

          const operatorSetting = new Setting(conditionRow).setClass('tps-gcm-no-border');
          operatorSetting.addDropdown(drop => {
            getOperatorOptions(type).forEach(option => drop.addOption(option.value, option.label));
            drop
              .setValue(operator)
              .onChange(async value => {
                condition.operator = normalizeConditionOperator(type, value);
                if (!operatorNeedsValue(type, condition.operator)) {
                  condition.value = '';
                }
                await this.plugin.saveSettings();
                this.display();
              });
          });

          const valueSetting = new Setting(conditionRow).setClass('tps-gcm-no-border');
          if (operatorNeedsValue(type, operator)) {
            valueSetting.addText(text => text
              .setPlaceholder(type === 'path' ? 'text to match in path' : 'value')
              .setValue(String(condition.value || ''))
              .onChange(async value => {
                condition.value = value;
                await this.plugin.saveSettings();
              }));
          } else {
            valueSetting.setName('');
          }

          new Setting(conditionRow)
            .setClass('tps-gcm-no-border')
            .addExtraButton(btn => btn
              .setIcon('x')
              .setTooltip('Remove condition')
              .onClick(async () => {
                currentRule.conditions!.splice(conditionIndex, 1);
                if (!currentRule.conditions!.length) {
                  currentRule.conditions = [createCondition('frontmatter')];
                }
                await this.plugin.saveSettings();
                this.display();
              }));
        });
      });

      if (migratedRules) {
        void this.plugin.saveSettings();
      }
    }

    // --- Automation Features (Consolidated) ---
    if (this.activeSettingsPage === 'workflows') {
      const automation = activePage;
      this.renderWorkflowNavigation(automation);
      automation.createEl('p', {
        text: 'Controller-owned scheduling and maintenance settings stay in TPS Controller. GCM keeps the note-interaction workflows below.',
        cls: 'setting-item-description'
      });

    if (this.activeWorkflowPage === 'time-tracking') {
      const timeTracking = automation.createDiv({ cls: 'tps-gcm-settings-editor-page' });
      timeTracking.dataset.tpsSettingsRoute = 'time-tracking';
      timeTracking.createEl('h4', { text: 'Time tracking' });
      timeTracking.createEl('p', {
        text: 'Track the current task or note while keeping every work-session notebook under one Daily Note heading.',
        cls: 'setting-item-description',
      });

    new Setting(timeTracking)
      .setName('Enable time tracking')
      .setDesc('Turns the note-level time tracking service, API, commands, and context-menu actions on or off.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableTimeTracking !== false)
          .onChange(async (value) => {
            this.plugin.settings.enableTimeTracking = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    if (this.plugin.settings.enableTimeTracking !== false) {
      new Setting(timeTracking)
        .setName('Property key')
        .setDesc('Frontmatter key used for time tracking sessions. This must not be scheduled.')
        .addText((text) =>
          text
            .setPlaceholder('timeTracking')
            .setValue(this.plugin.settings.timeTrackingPropertyKey || 'timeTracking')
            .onChange(async (value) => {
              const next = value.trim() || 'timeTracking';
              this.plugin.settings.timeTrackingPropertyKey = next.toLowerCase() === 'scheduled' ? 'timeTracking' : next;
              await this.plugin.saveSettings();
            })
        );

      new Setting(timeTracking)
        .setName('Storage mode')
        .setDesc('Choose where session records are stored. Working notes always stay in the session-start Daily Note.')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('daily-note', 'Daily note')
            .addOption('source-note', 'Source note')
            .addOption('dedicated-note', 'Dedicated note')
            .setValue(this.plugin.settings.timeTrackingStorageMode || 'daily-note')
            .onChange(async (value: 'daily-note' | 'source-note' | 'dedicated-note') => {
              this.plugin.settings.timeTrackingStorageMode = value;
              await this.plugin.saveSettings();
              this.display();
            })
        );

      if (this.plugin.settings.timeTrackingStorageMode === 'dedicated-note') {
        new Setting(timeTracking)
          .setName('Dedicated note path')
          .setDesc('Markdown note used when storage mode is Dedicated note.')
          .addText((text) =>
            text
              .setPlaceholder('Time Tracking.md')
              .setValue(this.plugin.settings.timeTrackingDedicatedNotePath || 'Time Tracking.md')
              .onChange(async (value) => {
                this.plugin.settings.timeTrackingDedicatedNotePath = value.trim() || 'Time Tracking.md';
                await this.plugin.saveSettings();
              })
          );
      }

      new Setting(timeTracking)
        .setName('Daily Note session heading')
        .setDesc('Heading that contains the editable notes workspace for each work session.')
        .addText((text) =>
          text
            .setPlaceholder('Time Tracking')
            .setValue(this.plugin.settings.timeTrackingDailyNoteHeading || 'Time Tracking')
            .onChange(async (value) => {
              this.plugin.settings.timeTrackingDailyNoteHeading = value
                .replace(/[\r\n]+/g, ' ')
                .replace(/^\s*#{1,6}\s*/, '')
                .trim()
                || 'Time Tracking';
              await this.plugin.saveSettings();
            })
        );

      new Setting(timeTracking)
        .setName('Daily Note session placement')
        .setDesc('For a new section, choose immediately after properties or the note bottom. Existing sections stay in place; new sessions are added first or last within them.')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('top', 'Top, after properties')
            .addOption('bottom', 'Bottom of note')
            .setValue(this.plugin.settings.timeTrackingDailyNotePlacement === 'bottom' ? 'bottom' : 'top')
            .onChange(async (value: 'top' | 'bottom') => {
              this.plugin.settings.timeTrackingDailyNotePlacement = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(timeTracking)
        .setName('Single active timer')
        .setDesc('When enabled, starting a timer while another is active asks before adding another running timer.')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.timeTrackingSingleActiveSession !== false)
            .onChange(async (value) => {
              this.plugin.settings.timeTrackingSingleActiveSession = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(timeTracking)
        .setName('Ignore archived files')
        .setDesc('Hide and skip running timers whose session storage, source note, or resolved target is inside the configured archive folder.')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.timeTrackingIgnoreArchivedFiles !== false)
            .onChange(async (value) => {
              this.plugin.settings.timeTrackingIgnoreArchivedFiles = value;
              await this.plugin.saveSettings();
              this.plugin.timeTrackingStatusBarService?.refresh();
            })
        );
    } else {
      timeTracking.createEl('p', {
        text: 'Time tracking is disabled. Calendar will not request tracked sessions while this is off.',
        cls: 'setting-item-description',
      });
    }
    }

    if (this.activeWorkflowPage === 'tasks') {
      const taskAutomation = automation.createDiv({ cls: 'tps-gcm-settings-editor-page' });
      taskAutomation.dataset.tpsSettingsRoute = 'tasks';
      taskAutomation.createEl('h4', { text: 'Tasks' });
      taskAutomation.createEl('p', {
        text: 'Task-line creation, hiding, checkbox/status mapping, and completion safeguards.',
        cls: 'setting-item-description',
      });
      new Setting(taskAutomation)
        .setName('When a Base has no write target')
        .setDesc('Fallback write note for new TPS List/Table task and bullet lines. Today’s Daily Note is the default; an exact active-view or whole-Base file.path/task.path filter always wins.')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('today-daily-note', 'Today’s Daily Note')
            .addOption('filter-required', 'Require a file.path/task.path filter')
            .addOption('specific-note', 'Specific note')
            .setValue(this.plugin.settings.tpsBaseWriteFallbackMode)
            .onChange(async (value) => {
              if (value !== 'filter-required' && value !== 'today-daily-note' && value !== 'specific-note') return;
              this.plugin.settings.tpsBaseWriteFallbackMode = value;
              await this.plugin.saveSettings();
              this.redisplayPreservingRouteFocus('tasks');
            })
        );
      if (this.plugin.settings.tpsBaseWriteFallbackMode === 'specific-note') {
        new Setting(taskAutomation)
          .setName('Fallback write note')
          .setDesc('Existing Markdown note used only when the effective Base filters do not identify an exact write target.')
          .addText((text) =>
            text
              .setPlaceholder('Inbox/Tasks.md')
              .setValue(this.plugin.settings.tpsBaseWriteFallbackPath)
              .onChange(async (value) => {
                this.plugin.settings.tpsBaseWriteFallbackPath = value.trim();
                await this.plugin.saveSettings();
              })
          )
          .addButton((button) =>
            button
              .setButtonText('Choose note')
              .onClick(() => {
                new FileSuggestModal(this.app, async (file) => {
                  this.plugin.settings.tpsBaseWriteFallbackPath = file.path;
                  await this.plugin.saveSettings();
                  this.redisplayPreservingRouteFocus('tasks');
                }, { extensions: ['md'] }).open();
              })
          );
      }
      new Setting(taskAutomation)
        .setName('Default attachments path')
        .setDesc('Folder where new attachment notes are created. Leave empty to use the vault root.')
        .addText((text) =>
          text
            .setPlaceholder('e.g., Attachments or Notes/Attachments')
            .setValue(this.plugin.settings.defaultAttachmentsPath)
            .onChange(async (value) => {
              this.plugin.settings.defaultAttachmentsPath = value.trim();
              await this.plugin.saveSettings();
            })
        );
    new Setting(taskAutomation)
      .setName('Checklist promote behavior')
      .setDesc('When promoting a checklist item to a subitem, choose whether to remove the line, complete + link it, or keep it open as a link.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('complete-and-link', 'Mark complete + link')
          .addOption('link-only', 'Link only')
          .addOption('remove', 'Remove checklist line')
          .setValue(this.plugin.settings.checklistPromotionBehavior ?? 'remove')
          .onChange(async (value) => {
            if (value === 'remove' || value === 'complete-and-link' || value === 'link-only') {
              this.plugin.settings.checklistPromotionBehavior = value;
              await this.plugin.saveSettings();
            }
          })
      );
    new Setting(taskAutomation)
      .setName('After moving a task from a Daily Note')
      .setDesc('Choose whether a cross-note move leaves a migrated scratchpad record or removes the complete source block. The destination task keeps its stable identity either way.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('mark-migrated', 'Keep a migrated marker')
          .addOption('remove', 'Remove the source block')
          .setValue(this.plugin.settings.dailyNoteTaskMoveSourceBehavior)
          .onChange(async (value) => {
            if (value !== 'mark-migrated' && value !== 'remove') return;
            this.plugin.settings.dailyNoteTaskMoveSourceBehavior = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(taskAutomation)
      .setName('Keep local item history')
      .setDesc('Record committed user actions such as task status, priority, tag, checkbox, move, and delete changes in a private plugin datastore. On its first tracked change, a surviving task receives a stable tpsId in the same note edit so later events remain attached to that task. Vault-relative before/after note paths, including filenames, are stored; other task edits are recorded without their text. Raw task content and note bodies are never stored, background automation is excluded, and this data stays on this device.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableItemHistory !== false)
          .onChange(async (value) => {
            const previous = this.plugin.settings.enableItemHistory !== false;
            if (Object.is(value, previous)) return;
            this.plugin.settings.enableItemHistory = value;
            this.plugin.itemHistoryService?.updateEnabled(value);
            try {
              await this.plugin.saveSettings();
            } catch (error) {
              this.plugin.settings.enableItemHistory = previous;
              this.plugin.itemHistoryService?.updateEnabled(previous);
              this.redisplayPreservingRouteFocus('tasks');
              throw error;
            }
            this.redisplayPreservingRouteFocus('tasks');
          })
      );
    if (this.plugin.settings.enableItemHistory !== false) {
      new Setting(taskAutomation)
        .setName('Item history retention')
        .setDesc('Events are also capped at 200 per item and 25,000 across the vault. Older events are pruned locally.')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('30', '30 days')
            .addOption('90', '90 days')
            .addOption('180', '180 days')
            .addOption('365', '1 year')
            .setValue(String(this.plugin.settings.itemHistoryRetentionDays || 90))
            .onChange(async (value) => {
              const days = Number.parseInt(value, 10);
              if (!Number.isFinite(days) || days < 1) return;
              this.plugin.settings.itemHistoryRetentionDays = days;
              await this.plugin.saveSettings();
              await this.plugin.itemHistoryService?.prune();
            })
        );
    }
    new Setting(taskAutomation)
      .setName('Hide completed task lines')
      .setDesc('Hide completed, won’t-do, and migrated task lines. Source mode always stays unchanged, and linked context follows the same visibility rule.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideCompletedCheckboxes === true)
          .onChange(async (value) => {
            this.plugin.settings.hideCompletedCheckboxes = value;
            await this.plugin.saveSettings();
            this.plugin.hideCompletedCheckboxesService?.applyBodyClass();
            this.plugin.hideCompletedCheckboxesService?.refreshAllEditors();
            this.plugin.persistentMenuManager.ensureMenus();
            this.redisplayPreservingRouteFocus('tasks');
          })
      );
    new Setting(taskAutomation)
      .setName('Hide completed tasks in')
      .setDesc('Reading view only leaves Live Preview untouched. The combined option preserves the earlier behavior and includes a temporary reveal button in Live Preview.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('reading-only', 'Reading view only')
          .addOption('reading-and-live-preview', 'Reading view and Live Preview')
          .setValue(this.plugin.settings.completedTaskHidingScope || 'reading-and-live-preview')
          .onChange(async (value: 'reading-only' | 'reading-and-live-preview') => {
            this.plugin.settings.completedTaskHidingScope = value;
            await this.plugin.saveSettings();
            this.plugin.hideCompletedCheckboxesService?.applyBodyClass();
            this.plugin.hideCompletedCheckboxesService?.refreshAllEditors();
            this.plugin.persistentMenuManager.ensureMenus();
          })
      );
    new Setting(taskAutomation)
      .setName('Hide all task lines in reading mode')
      .setDesc('Hide all rendered task list lines in reading view, regardless of task status. Source mode is unchanged.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideAllTaskLinesInReadingMode === true)
          .onChange(async (value) => {
            this.plugin.settings.hideAllTaskLinesInReadingMode = value;
            await this.plugin.saveSettings();
          })
      );
    new Setting(taskAutomation)
      .setName('Task hiding exclusions')
      .setDesc('Files, folders, tags, or cssclasses where completed/all-task hiding is disabled. One pattern per line; supports exact paths, folder prefixes, wildcards (*), name:<basename>, re:<regex>, #tag, tag:<tag>, and cssclass:<class>.')
      .addTextArea((text) => {
        text
          .setValue(this.plugin.settings.taskHidingExclusionPatterns ?? '')
          .setPlaceholder('Inbox/\n#tps/workout\nname:Inbox')
          .onChange(async (value) => {
            this.plugin.settings.taskHidingExclusionPatterns = value;
            await this.plugin.saveSettings();
          });
      });
    new Setting(taskAutomation)
      .setName('Persist task reveal state to frontmatter')
      .setDesc('When enabled, the Show completed and Show tasks buttons write per-note reveal state to frontmatter instead of resetting per view. The default is off, so task hiding stays temporary unless this is enabled.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.persistTaskVisibilityStateToFrontmatter === true)
          .onChange(async (value) => {
            this.plugin.settings.persistTaskVisibilityStateToFrontmatter = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );
    if (this.plugin.settings.persistTaskVisibilityStateToFrontmatter === true) {
      new Setting(taskAutomation)
        .setName('Task reveal frontmatter key')
        .setDesc('Single frontmatter property used to store showCompleted and showTasks state for this note.')
        .addText((text) =>
          text
            .setPlaceholder('gcmTaskVisibility')
            .setValue(this.plugin.settings.taskVisibilityStateFrontmatterKey || 'gcmTaskVisibility')
            .onChange(async (value) => {
              this.plugin.settings.taskVisibilityStateFrontmatterKey = value.trim() || 'gcmTaskVisibility';
              await this.plugin.saveSettings();
            })
        );
    }
    this.renderLinkedSubitemCheckboxSettings(taskAutomation);
    new Setting(taskAutomation)
      .setName('Sync inline status to checkbox marker')
      .setDesc('When a task line has the configured status property, map it to the checkbox marker and remove the inline status field.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.reconcileTaskStatusToCheckbox !== false).onChange(async (v) => {
          this.plugin.settings.reconcileTaskStatusToCheckbox = v;
          await this.plugin.saveSettings();
          if (v) this.plugin.taskStatusCheckboxReconcileService?.scheduleActiveFile('settings-enabled');
        })
      );
    new Setting(taskAutomation).setName('Warn before completing with open subtasks').setDesc('When completing a note, warn if unchecked task lines remain in the note body.').addToggle(t => t.setValue(this.plugin.settings.checkOpenChecklistItems).onChange(async v => { this.plugin.settings.checkOpenChecklistItems = v; await this.plugin.saveSettings(); }));
    new Setting(taskAutomation).setName('Warn before completing with open child notes').setDesc('When completing a note, warn if linked child notes still have an open status.').addToggle(t => t.setValue(this.plugin.settings.checkParentLinkStatuses).onChange(async v => { this.plugin.settings.checkParentLinkStatuses = v; await this.plugin.saveSettings(); }));
    new Setting(taskAutomation)
      .setName('Completion prompt status options')
      .setDesc('When the last open checkbox is resolved on a note that already has a status, offer these note statuses, comma-separated.')
      .addText((t) =>
        t.setValue((this.plugin.settings.checklistFinalPromptStatuses || ['complete', 'wont-do']).join(', '))
          .onChange(async (v) => {
            const next = v.split(',').map((s) => s.trim()).filter(Boolean);
            this.plugin.settings.checklistFinalPromptStatuses = next.length > 0 ? next : ['complete', 'wont-do'];
            await this.plugin.saveSettings();
          })
      );
    }

    if (this.activeWorkflowPage === 'child-notes') {
      const relationshipAutomation = automation.createDiv({ cls: 'tps-gcm-settings-editor-page' });
      relationshipAutomation.dataset.tpsSettingsRoute = 'child-notes';
      relationshipAutomation.createEl('h4', { text: 'Child notes' });
      relationshipAutomation.createEl('p', {
        text: 'Parent links, completion classification, and child-panel filters.',
        cls: 'setting-item-description',
      });
    new Setting(relationshipAutomation).setName('Child parent property key').setDesc('Frontmatter key used on child notes to store parent links. Multiple parents are stored as an array under this key. Legacy parent/parents/childOf values are still read and migrated on write.').addText(t => t.setValue(this.plugin.settings.parentLinkFrontmatterKey || 'parent').onChange(async v => { this.plugin.settings.parentLinkFrontmatterKey = v.trim() || 'parent'; await this.plugin.saveSettings(); }));
    new Setting(relationshipAutomation)
      .setName('Ignore matching parent/child notes')
      .setDesc('When enabled, notes matching the exact property key and value below are excluded from parent/child discovery, panels, and automation. Existing links and frontmatter are preserved.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableParentChildIgnoreRule === true)
          .onChange(async (value) => {
            this.plugin.settings.enableParentChildIgnoreRule = value;
            await this.plugin.saveSettings();
            this.plugin.linkedSubitemCheckboxService.ensureForAllMarkdownViews();
            this.plugin.linkedSubitemCheckboxService.refreshLivePreviewEditors();
            this.plugin.persistentMenuManager.ensureMenus();
            this.redisplayPreservingRouteFocus('child-notes');
          })
      );
    new Setting(relationshipAutomation)
      .setName('Parent/child ignore pair')
      .setDesc('Both fields must match. Keys and scalar/list values are compared case-insensitively; an incomplete pair disables the rule.')
      .addText((text) => {
        text
          .setPlaceholder('gcmParentChild')
          .setValue(this.plugin.settings.parentChildIgnoreFrontmatterKey || '')
          .onChange(async (value) => {
            this.plugin.settings.parentChildIgnoreFrontmatterKey = value.trim();
            await this.plugin.saveSettings();
            this.plugin.linkedSubitemCheckboxService.ensureForAllMarkdownViews();
            this.plugin.linkedSubitemCheckboxService.refreshLivePreviewEditors();
            this.plugin.persistentMenuManager.ensureMenus();
          });
        text.inputEl.setAttribute('aria-label', 'Parent child ignore property key');
      })
      .addText((text) => {
        text
          .setPlaceholder('ignore')
          .setValue(this.plugin.settings.parentChildIgnoreFrontmatterValue || '')
          .onChange(async (value) => {
            this.plugin.settings.parentChildIgnoreFrontmatterValue = value.trim();
            await this.plugin.saveSettings();
            this.plugin.linkedSubitemCheckboxService.ensureForAllMarkdownViews();
            this.plugin.linkedSubitemCheckboxService.refreshLivePreviewEditors();
            this.plugin.persistentMenuManager.ensureMenus();
          });
        text.inputEl.setAttribute('aria-label', 'Parent child ignore property value');
      });
    new Setting(relationshipAutomation)
      .setName('Body link format')
      .setDesc('Controls parent-note body links. Child frontmatter is always stored as wikilinks so Bases can compare it with file links.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('wikilink', 'Wikilink ([[path|Title]])')
          .addOption('markdown-title', 'Markdown ([Title](path))')
          .setValue(normalizeParentLinkFormat(this.plugin.settings.parentLinkFormat))
          .onChange(async (value: 'wikilink' | 'markdown-title') => {
            this.plugin.settings.parentLinkFormat = normalizeParentLinkFormat(value);
            await this.plugin.saveSettings();
          })
      );
    new Setting(relationshipAutomation)
      .setName('Hide child body links from connections')
      .setDesc('Keep promoted child-note links out of the page connections button.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.ignoreEmbeddedChildrenInTopLinks ?? true).onChange(async (v) => {
          this.plugin.settings.ignoreEmbeddedChildrenInTopLinks = v;
          await this.plugin.saveSettings();
          this.plugin.persistentMenuManager.ensureMenus();
        })
      );
    new Setting(relationshipAutomation)
      .setName('Hidden child-note tags')
      .setDesc('Comma-separated tags to exclude from the child-note panel, such as hide, dailynote, or project.')
      .addText((t) =>
        t.setValue((this.plugin.settings.ignoredSubitemTags || ['hide', 'dailynote', 'project']).join(', '))
          .onChange(async (v) => {
            this.plugin.settings.ignoredSubitemTags = v.split(',').map((s) => s.trim()).filter(Boolean);
            await this.plugin.saveSettings();
          })
      );
    new Setting(relationshipAutomation).setName('Child complete statuses').setDesc('Child note statuses treated as complete.').addText(t => t.setValue((this.plugin.settings.parentCompletionStatuses || []).join(', ')).onChange(async v => { this.plugin.settings.parentCompletionStatuses = v.split(',').map(s => s.trim()).filter(Boolean); await this.plugin.saveSettings(); }));
    new Setting(relationshipAutomation)
      .setName('Ignored backlink frontmatter keys')
      .setDesc('Comma-separated list of frontmatter keys to hide from the Frontmatter section in the Backlinks panel (e.g. "dateModified, dateCreated").')
      .addText(t => t
        .setPlaceholder('dateModified, dateCreated')
        .setValue((this.plugin.settings.ignoredBacklinksFrontmatterKeys || []).join(', '))
        .onChange(async v => {
          this.plugin.settings.ignoredBacklinksFrontmatterKeys = v.split(',').map(s => s.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }));
    }

    if (this.activeWorkflowPage === 'recurrence') {
      const advancedAutomation = automation.createDiv({ cls: 'tps-gcm-settings-editor-page' });
      advancedAutomation.dataset.tpsSettingsRoute = 'recurrence';
      advancedAutomation.createEl('h4', { text: 'Recurrence' });
      advancedAutomation.createEl('p', {
        text: hasController
          ? 'GCM owns note-level recurrence behavior; prefer TPS Controller for orchestration and archive scheduling.'
          : 'Configure how GCM creates the next recurring note instance.',
        cls: 'setting-item-description',
      });
    new Setting(advancedAutomation).setName('Note Recurrence').setDesc('Auto-create the next note instance when a recurring note is completed.').addToggle(t => t.setValue(this.plugin.settings.enableRecurrence).onChange(async v => { this.plugin.settings.enableRecurrence = v; await this.plugin.saveSettings(); this.display(); }));


    new Setting(advancedAutomation)
      .setName('Auto-rename files')
      .setDesc('Keep filenames aligned with title and scheduled values when GCM updates note metadata.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoRename)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoRename = value;
            await this.plugin.saveSettings();
          })
      );

    if (this.plugin.settings.enableRecurrence) {
      const sub = advancedAutomation.createDiv({ cls: 'tps-gcm-sub-settings' });
      sub.style.paddingLeft = '15px';
      sub.style.borderLeft = '2px solid var(--background-modifier-border)';
      new Setting(sub).setName('Active Status Values').setDesc('Statuses treated as still active/open by integrations. Any configured status not listed here is considered non-active for rendering like Calendar dimming.').addText(t => t.setValue((this.plugin.settings.activeStatusValues || ['todo', 'working', 'holding']).join(', ')).onChange(async v => { this.plugin.settings.activeStatusValues = v.split(',').map(s => s.trim()).filter(Boolean); await this.plugin.saveSettings(); }));
      new Setting(sub).setName('Completion Triggers').setDesc('Statuses that trigger recurrence').addText(t => t.setValue((this.plugin.settings.recurrenceCompletionStatuses || []).join(', ')).onChange(async v => { this.plugin.settings.recurrenceCompletionStatuses = v.split(',').map(s => s.trim()).filter(Boolean); await this.plugin.saveSettings(); }));
      new Setting(sub).setName('Prompt on Edit').setDesc('Ask to update future instances').addToggle(t => t.setValue(this.plugin.settings.promptOnRecurrenceEdit).onChange(async v => { this.plugin.settings.promptOnRecurrenceEdit = v; await this.plugin.saveSettings(); }));
      new Setting(sub).setName('Template Folder').setDesc('Folder for recurring event templates (copied when recurrence first set). Leave blank to disable.').addText(t => t.setPlaceholder('e.g. Recurring Templates').setValue(this.plugin.settings.recurringTemplateFolder || '').onChange(async v => { this.plugin.settings.recurringTemplateFolder = v.trim(); await this.plugin.saveSettings(); }));
    }
    }

    if (this.activeWorkflowPage === 'home-daily') {
      const navigationAutomation = automation.createDiv({ cls: 'tps-gcm-settings-editor-page' });
      navigationAutomation.dataset.tpsSettingsRoute = 'home-daily';
      navigationAutomation.createEl('h4', { text: 'Home & daily notes' });
      navigationAutomation.createEl('p', {
        text: 'Choose whether Daily Notes use TPS Home, then configure capture, navigation, and scheduled-task behavior. Base cards are selected directly from Home edit mode.',
        cls: 'setting-item-description',
      });

      new Setting(navigationAutomation)
        .setName('Use TPS Home for Daily Notes')
        .setDesc('Replace Daily Notes in Reading view with their date-backed Home dashboard. Turn this off to keep normal Markdown Reading view; standalone TPS Home remains available on demand.')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.enableDailyNoteHome !== false)
            .onChange(async (value) => {
              const generation = ++this.dailyNoteHomeToggleGeneration;
              const previousValue = this.plugin.settings.enableDailyNoteHome !== false;
              const service = this.plugin.dailyNoteHomeService;
              const result = await runDailyNoteHomeSettingTransaction({
                requestedValue: value,
                previousValue,
                applyEnabled: (enabled) => service?.setEnabled(enabled) ?? Promise.resolve(true),
                getEnabled: () => service?.isEnabled() ?? this.plugin.settings.enableDailyNoteHome !== false,
                setSetting: (enabled) => {
                  this.plugin.settings.enableDailyNoteHome = enabled;
                },
                persist: () => this.plugin.saveSettings(),
                isCurrent: () => generation === this.dailyNoteHomeToggleGeneration,
                isAvailable: () => service?.isAvailable() ?? true,
              });
              if (result.status === 'applied' || result.status === 'stale' || result.status === 'unavailable') return;

              toggle.setValue(result.effectiveValue);
              logger.flowError('Settings', 'daily-note-home-toggle-failed', result.error, {
                requested: value,
                status: result.status,
                effectiveValue: result.effectiveValue,
                persisted: result.persisted,
              });
              if (result.rollbackError) {
                logger.flowError('Settings', 'daily-note-home-toggle-rollback-failed', result.rollbackError);
              }
              if (result.recoveryError) {
                logger.flowError('Settings', 'daily-note-home-toggle-recovery-failed', result.recoveryError);
              }
              if (result.persistenceError) {
                logger.flowError('Settings', 'daily-note-home-toggle-compensating-save-failed', result.persistenceError, {
                  effectiveValue: result.effectiveValue,
                });
              }

              if (result.status === 'rolled-back') {
                new Notice(result.persisted
                  ? 'Could not change Daily Note Home. The previous setting was restored.'
                  : 'Daily Note Home returned to its previous state, but saving that rollback failed. Try again before restarting Obsidian.');
              } else if (result.status === 'recovered-requested') {
                new Notice(result.persisted
                  ? 'The previous Daily Note Home view state could not be restored, so the requested state was kept and saved.'
                  : 'Could not save the Daily Note Home change, and the previous view state could not be restored. The requested state remains active for this session.');
              } else {
                new Notice('Could not change Daily Note Home or fully restore the previous view state. Review open Home tabs, then try again.');
              }
            })
        );

      new Setting(navigationAutomation)
        .setName('Home capture position')
        .setDesc('Where TPS Home quick capture inserts new lines in the Daily Note.')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('bottom', 'Bottom of note')
            .addOption('top', 'Top after frontmatter')
            .setValue(this.plugin.settings.homeCaptureInsertPosition || 'bottom')
            .onChange(async (value: 'top' | 'bottom') => {
              this.plugin.settings.homeCaptureInsertPosition = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(navigationAutomation)
        .setName('Collapse headings on first open')
        .setDesc('Desktop only. When a Markdown note is opened and was not already open in another tab, run Obsidian fold-all so headings start collapsed. Mobile skips this automation so native heading/list collapse controls stay responsive.')
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.collapseHeadingsOnOpen === true)
            .onChange(async (value) => {
              this.plugin.settings.collapseHeadingsOnOpen = value;
              await this.plugin.saveSettings();
            })
        );
    new Setting(navigationAutomation)
      .setName('Enable Daily Note Navigation')
      .setDesc('Show hovering Previous/Today/Next controls on daily notes.')
      .addToggle(t => t.setValue(this.plugin.settings.enableDailyNoteNav).onChange(async v => {
        this.plugin.settings.enableDailyNoteNav = v;
        await this.plugin.saveSettings();
        this.display();
        (this.plugin as any).overlayRenderingService?.scheduleDailyNavRefresh?.('daily-nav-setting-change', 0);
        if ((this.plugin as any).dailyNoteNavManager) {
          (this.plugin as any).dailyNoteNavManager.refresh();
        }
      }));

    if (this.plugin.settings.enableDailyNoteNav) {
      new Setting(navigationAutomation)
        .setName('Show "Today" button')
        .setDesc('Show a Today shortcut between the prev/next arrows. Disable to show only the arrows.')
        .addToggle(t => t.setValue(this.plugin.settings.dailyNavShowToday !== false).onChange(async v => {
          this.plugin.settings.dailyNavShowToday = v;
          await this.plugin.saveSettings();
          (this.plugin as any).overlayRenderingService?.scheduleDailyNavRefresh?.('daily-nav-setting-change', 0);
          if ((this.plugin as any).dailyNoteNavManager) {
            (this.plugin as any).dailyNoteNavManager.refresh();
          }
        }));

      new Setting(navigationAutomation)
        .setName('Auto-Populate Scheduled Items')
        .setDesc('When opening a Daily Note, automatically scan the vault and insert links to subitems scheduled for that date into the note body.')
        .addToggle(t => t.setValue(this.plugin.settings.enableAutoPopulateDailyNotes !== false).onChange(async v => {
          this.plugin.settings.enableAutoPopulateDailyNotes = v;
          await this.plugin.saveSettings();
        }));

      new Setting(navigationAutomation)
        .setName('Inherit Daily Note date for unscheduled tasks')
        .setDesc('Treat task lines without an explicit scheduled value inside Daily Notes as scheduled on that Daily Note date. If a different scheduled date is set from the task menu, GCM will offer to move the task block to that date\'s Daily Note.')
        .addToggle(t => t.setValue(this.plugin.settings.inheritUnscheduledTasksFromDailyNotes !== false).onChange(async v => {
          this.plugin.settings.inheritUnscheduledTasksFromDailyNotes = v;
          await this.plugin.saveSettings();
          this.plugin.eventService.emitFilesUpdated([]);
          this.plugin.overlayRenderingService?.invalidate({
            reason: 'daily-note-task-schedule-inheritance-setting-change',
            surfaces: ['menus', 'linked-subitems', 'daily-nav', 'live-preview-editors'],
            rebuildInlineSubitems: true,
            refreshLivePreviewEditors: true,
            delayMs: 50,
          });
        }));
    }
    }
    }

    if (this.activeSettingsPage === 'advanced') {
      const diagnostics = activePage;
      diagnostics.createEl('h4', { text: 'Data architecture' });

      new Setting(diagnostics)
        .setName('TPS data architecture')
        .setDesc('Legacy keeps TPS List/Table, virtual Base embeds, line-row indexing, and non-Markdown companion properties. Native records keeps GCM menus and inline-task tools while ordinary Markdown records and core Bases own stored data and filtering. Changing this requires an Obsidian reload.')
        .addDropdown((dropdown) => dropdown
          .addOption('legacy', 'Legacy TPS views and companions')
          .addOption('native-records', 'Native Markdown records and core Bases')
          .setValue(this.plugin.settings.dataArchitectureMode || 'legacy')
          .onChange(async (value) => {
            this.plugin.settings.dataArchitectureMode = value === 'native-records'
              ? 'native-records'
              : 'legacy';
            await this.plugin.saveSettings();
            new Notice('Reload Obsidian to apply the TPS data architecture change.');
          }));

      new Setting(diagnostics)
        .setName('Native record root')
        .setDesc('Vault-relative destination for generated task, calendar, food, activity, workout, and asset records. Enter / for the vault root. This remains editable before native mode is enabled.')
        .addText((text) => text
          .setPlaceholder('_records')
          .setValue(this.plugin.settings.nativeRecordRootPath || '/')
          .onChange(async (value) => {
            this.plugin.settings.nativeRecordRootPath = normalizeNativeRecordRoot(value);
            await this.plugin.saveSettings();
          }));

      new Setting(diagnostics)
        .setName('Native record layout')
        .setDesc('Kind folders preserves the existing _records/tasks-style layout. Flat stores every generated record directly in the selected destination, using its stable TPS ID as the filename.')
        .addDropdown((dropdown) => dropdown
          .addOption('kind-folders', 'Separate folders by record kind')
          .addOption('flat-root', 'Flat in the selected destination')
          .setValue(this.plugin.settings.nativeRecordLayout || 'kind-folders')
          .onChange(async (value) => {
            this.plugin.settings.nativeRecordLayout = normalizeNativeRecordLayout(value);
            await this.plugin.saveSettings();
          }));

      diagnostics.createEl('h4', { text: 'Native record properties' });

      new Setting(diagnostics)
        .setName('Store record identity as')
        .setDesc('Property mode writes configurable ID and schema properties. Tag mode stores schema, kind, and ID in one configurable tag and writes no ID or schema property. Existing profiles remain readable until you consolidate them below.')
        .addDropdown((dropdown) => dropdown
          .addOption('property', 'Properties')
          .addOption('tag', 'Tag')
          .setValue(this.plugin.settings.nativeRecordIdentityMode || 'property')
          .onChange(async (value) => {
            this.plugin.nativeRecordService.rememberCurrentStorageProfile();
            this.plugin.settings.nativeRecordIdentityMode = value === 'tag' ? 'tag' : 'property';
            await this.plugin.saveSettings();
          }));

      new Setting(diagnostics)
        .setName('Identity property names')
        .setDesc('Used in property mode. These values remain editable while tag mode is active so the fallback profile is always configurable.')
        .addText((text) => text
          .setPlaceholder('tpsId')
          .setValue(this.plugin.settings.nativeRecordIdentityPropertyKey || '')
          .onChange(async (value) => {
            this.plugin.nativeRecordService.rememberCurrentStorageProfile();
            this.plugin.settings.nativeRecordIdentityPropertyKey = normalizeNativeRecordStorageProfile({
              identityPropertyKey: value,
            }).identityPropertyKey;
            await this.plugin.saveSettings();
          }))
        .addText((text) => text
          .setPlaceholder('tpsSchemaVersion')
          .setValue(this.plugin.settings.nativeRecordSchemaPropertyKey || '')
          .onChange(async (value) => {
            this.plugin.nativeRecordService.rememberCurrentStorageProfile();
            this.plugin.settings.nativeRecordSchemaPropertyKey = normalizeNativeRecordStorageProfile({
              schemaPropertyKey: value,
            }).schemaPropertyKey;
            await this.plugin.saveSettings();
          }));

      new Setting(diagnostics)
        .setName('Identity tag prefix')
        .setDesc('Used in tag mode, without #. A record tag contains this prefix plus schema, kind, and the stable ID, for example #tps/record/v1/task/task-123.')
        .addText((text) => text
          .setPlaceholder('tps/record')
          .setValue(this.plugin.settings.nativeRecordIdentityTagPrefix || '')
          .onChange(async (value) => {
            this.plugin.nativeRecordService.rememberCurrentStorageProfile();
            this.plugin.settings.nativeRecordIdentityTagPrefix = normalizeNativeRecordStorageProfile({
              identityTagPrefix: value,
            }).identityTagPrefix;
            await this.plugin.saveSettings();
          }));

      new Setting(diagnostics)
        .setName('Kind and title properties')
        .setDesc('Choose the frontmatter names used by native records. Leave Kind blank only when consumers should derive kind from a tag identity. Title must have a property name so it survives reloads.')
        .addText((text) => text
          .setPlaceholder('kind (blank allowed)')
          .setValue(this.plugin.settings.nativeRecordKindPropertyKey || '')
          .onChange(async (value) => {
            this.plugin.nativeRecordService.rememberCurrentStorageProfile();
            this.plugin.settings.nativeRecordKindPropertyKey = value.trim();
            await this.plugin.saveSettings();
          }))
        .addText((text) => text
          .setPlaceholder('title')
          .setValue(this.plugin.settings.nativeRecordTitlePropertyKey || '')
          .onChange(async (value) => {
            this.plugin.nativeRecordService.rememberCurrentStorageProfile();
            this.plugin.settings.nativeRecordTitlePropertyKey = normalizeNativeRecordStorageProfile({
              titlePropertyKey: value,
            }).titlePropertyKey;
            await this.plugin.saveSettings();
          }));

      new Setting(diagnostics)
        .setName('Timestamp properties')
        .setDesc('Choose the frontmatter names used for creation and modification timestamps. Leave either blank to stop writing that timestamp field on newly created or consolidated records.')
        .addText((text) => text
          .setPlaceholder('createdDate (blank disables)')
          .setValue(this.plugin.settings.nativeRecordCreatedPropertyKey || '')
          .onChange(async (value) => {
            this.plugin.nativeRecordService.rememberCurrentStorageProfile();
            this.plugin.settings.nativeRecordCreatedPropertyKey = value.trim();
            await this.plugin.saveSettings();
          }))
        .addText((text) => text
          .setPlaceholder('modifiedDate (blank disables)')
          .setValue(this.plugin.settings.nativeRecordModifiedPropertyKey || '')
          .onChange(async (value) => {
            this.plugin.nativeRecordService.rememberCurrentStorageProfile();
            this.plugin.settings.nativeRecordModifiedPropertyKey = value.trim();
            await this.plugin.saveSettings();
          }));

      new Setting(diagnostics)
        .setName('Consolidate native record storage')
        .setDesc('Rewrite recognized native records to the current identity and property profile. User properties, tags, bodies, stable IDs, and filenames are preserved. Records that cannot be proven unique fail closed.')
        .addButton((button) => button
          .setButtonText('Consolidate records')
          .onClick(async () => {
            button.setDisabled(true);
            try {
              const result = await this.plugin.nativeRecordService.migrateStorageProfile();
              new Notice(`Native records: ${result.updated} updated, ${result.skipped} already current, ${result.failed} failed.`);
            } catch (error) {
              new Notice(error instanceof Error ? error.message : String(error));
            } finally {
              button.setDisabled(false);
            }
          }));

      diagnostics.createEl('h4', { text: 'Template identity' });

      new Setting(diagnostics)
        .setName('Identify TPS templates by')
        .setDesc('Controls template discovery in TPS pickers. Exact template paths remain valid. The folder option follows Templater; tag and property modes work in a folderless vault.')
        .addDropdown((dropdown) => dropdown
          .addOption('templater-folder', 'Templater folder')
          .addOption('tag', 'Tag')
          .addOption('property', 'Property key and value')
          .setValue(this.plugin.settings.templateIdentificationMode || 'templater-folder')
          .onChange(async (value) => {
            this.plugin.settings.templateIdentificationMode = value === 'tag' || value === 'property'
              ? value
              : 'templater-folder';
            await this.plugin.saveSettings();
            this.display();
          }));

      new Setting(diagnostics)
        .setName('Template tag')
        .setDesc('Used when template identity is Tag. Enter the tag without #. This remains editable in every mode.')
        .addText((text) => text
          .setPlaceholder('tps-template')
          .setValue(this.plugin.settings.templateIdentificationTag || '')
          .onChange(async (value) => {
            this.plugin.settings.templateIdentificationTag = value.trim().replace(/^#+/, '');
            await this.plugin.saveSettings();
          }));

      new Setting(diagnostics)
        .setName('Template property')
        .setDesc('Used when template identity is Property. Matching is case-insensitive. Contains is useful for unresolved template expressions such as a title containing <% .')
        .addText((text) => text
          .setPlaceholder('tpsTemplate')
          .setValue(this.plugin.settings.templateIdentificationPropertyKey || '')
          .onChange(async (value) => {
            this.plugin.settings.templateIdentificationPropertyKey = value.trim();
            await this.plugin.saveSettings();
          }))
        .addDropdown((dropdown) => dropdown
          .addOption('equals', 'equals')
          .addOption('contains', 'contains')
          .setValue(this.plugin.settings.templateIdentificationPropertyMatch || 'equals')
          .onChange(async (value) => {
            this.plugin.settings.templateIdentificationPropertyMatch = value === 'contains' ? 'contains' : 'equals';
            await this.plugin.saveSettings();
          }))
        .addText((text) => text
          .setPlaceholder('true')
          .setValue(this.plugin.settings.templateIdentificationPropertyValue || '')
          .onChange(async (value) => {
            this.plugin.settings.templateIdentificationPropertyValue = value.trim();
            await this.plugin.saveSettings();
          }));

      diagnostics.createEl('h4', { text: 'Debug logging' });

      new Setting(diagnostics)
        .setName('Enable console logging')
        .setDesc('Show debug logs in the developer console.')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.enableLogging).onChange(async (value) => {
            this.plugin.settings.enableLogging = value;
            await this.plugin.saveSettings();
          }),
        );

      new Setting(diagnostics)
        .setName('Log opener decisions')
        .setDesc('When console logging is enabled, log compact tab-routing decisions for note opens.')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.logOpenerDecisions === true).onChange(async (value) => {
            this.plugin.settings.logOpenerDecisions = value;
            await this.plugin.saveSettings();
          }),
        );

      this.renderBaseQueryGuide(diagnostics);
    }

    containerEl.createEl('p', {
      text: 'Note: native context menu items are preserved; TPS actions are injected when context targets match.',
      cls: 'setting-item-description',
      attr: { style: 'margin-top: 20px; text-align: center; opacity: 0.7;' }
    });
  }

  renderProperties(container: HTMLElement) {
    container.empty();

    // Ensure properties exists
    if (!this.plugin.settings.properties) {
      this.plugin.settings.properties = [];
    }

    const healthPlugin = (this.app as any)?.plugins?.getPlugin?.('tps-health')
      || (this.app as any)?.plugins?.plugins?.['tps-health'];
    const healthApi = healthPlugin?.api || healthPlugin;
    const canImportHealthProperties = typeof healthApi?.getPropertyCatalog === 'function';
    new Setting(container)
      .setName('Install TPS task and Health fields')
      .setDesc(canImportHealthProperties
        ? 'Add or refresh the fields TPS actually writes. Task workflow fields are limited to tasks; Health fields are limited to their food, activity, exercise, workout, or Daily Note record kinds.'
        : 'Install the scoped task field catalog now. Enable or update TPS Health and run this again to add its scoped Health fields.')
      .addButton((button) => {
        button
          .setButtonText('Install / refresh')
          .onClick(async () => {
            try {
              const taskResult = installTaskRecordProperties(this.plugin.settings.properties || []);
              const healthResult = canImportHealthProperties
                ? importHealthPropertyCatalog(taskResult.properties, await Promise.resolve(healthApi.getPropertyCatalog()))
                : { properties: taskResult.properties, added: 0, updated: 0, removed: 0 };
              this.plugin.settings.properties = healthResult.properties as CustomProperty[];
              await this.plugin.saveSettings();
              logger.flow('Settings', 'tps-record-properties:installed', {
                taskAdded: taskResult.added,
                taskUpdated: taskResult.updated,
                healthAdded: healthResult.added,
                healthUpdated: healthResult.updated,
                healthRemoved: healthResult.removed,
                total: healthResult.properties.length,
              });
              new Notice(`TPS record fields refreshed: ${taskResult.added + healthResult.added} added, ${taskResult.updated + healthResult.updated} updated${healthResult.removed ? `, ${healthResult.removed} retired` : ''}.`);
              this.display();
            } catch (error) {
              logger.flowError('Settings', 'tps-record-properties:install-failed', error);
              new Notice('Could not install TPS record fields. Update TPS Health and try again.');
            }
          });
      });

    this.plugin.settings.properties.forEach((prop, index) => {
      const stateKey = `Custom Property::${prop.id || prop.key || index}`;
      const details = container.createEl('details', { cls: 'tps-gcm-setting-item tps-collapsible-section' });
      details.style.marginBottom = '10px';
      details.style.borderRadius = '6px';
      details.style.border = '1px solid var(--background-modifier-border)';
      if (this.sectionState.get(stateKey) ?? false) details.setAttr('open', 'true');
      details.addEventListener('toggle', () => {
        this.sectionState.set(stateKey, details.open);
      });

      const summary = details.createEl('summary', { cls: 'tps-collapsible-section-summary' });
      summary.style.display = 'flex';
      summary.style.alignItems = 'center';
      summary.style.justifyContent = 'space-between';
      summary.style.gap = '12px';
      const summaryTitle = summary.createSpan({ cls: 'tps-collapsible-section-title' });
      summaryTitle.createEl('strong', { text: prop.label || 'Unnamed Property' });
      summaryTitle.createSpan({ text: `  ${prop.key || '(no key)'} · ${prop.type || 'text'}` });

      const div = details.createDiv({ cls: 'tps-collapsible-section-content' });
      let valueSettingsHost: HTMLElement | null = null;
      div.style.padding = '10px';
      div.style.display = 'flex';
      div.style.flexDirection = 'column';
      div.style.gap = '10px';

      const controls = div.createDiv();
      controls.style.display = 'flex';
      controls.style.gap = '6px';
      controls.style.justifyContent = 'flex-end';

      // Move Up
      if (index > 0) {
        const upBtn = controls.createEl('button', { text: '↑' });
        upBtn.onclick = async () => {
          const temp = this.plugin.settings.properties[index - 1];
          this.plugin.settings.properties[index - 1] = prop;
          this.plugin.settings.properties[index] = temp;
          await this.plugin.saveSettings();
          this.display();
        };
      }

      // Move Down
      if (index < this.plugin.settings.properties.length - 1) {
        const downBtn = controls.createEl('button', { text: '↓' });
        downBtn.onclick = async () => {
          const temp = this.plugin.settings.properties[index + 1];
          this.plugin.settings.properties[index + 1] = prop;
          this.plugin.settings.properties[index] = temp;
          await this.plugin.saveSettings();
          this.display();
        };
      }

      const delBtn = controls.createEl('button', { text: 'Delete' });
      delBtn.onclick = async () => {
        this.plugin.settings.properties.splice(index, 1);
        await this.plugin.saveSettings();
        this.display();
      };

      // Edit Fields
      const fields = div.createDiv();
      fields.style.display = 'grid';
      fields.style.gridTemplateColumns = '1fr 1fr';
      fields.style.gap = '10px';

      // Label
      new Setting(fields)
        .setName('Label')
        .addText(text => text
          .setValue(prop.label)
          .onChange(async (value) => {
            prop.label = value;
            await this.plugin.saveSettings();
          }));

      // Key
      const keySetting = new Setting(fields)
        .setName('Frontmatter Key')
        .setDesc('Required. Matching ignores case but preserves punctuation and interior spaces.')
        .addText(text => text
          .setValue(prop.key)
          .onChange(async (value) => {
            const candidate = value.trim();
            const diagnostic = getPropertyKeyDiagnostic(this.plugin.settings.properties, index, candidate);
            text.inputEl.setAttribute('aria-invalid', diagnostic ? 'true' : 'false');
            keySetting.settingEl.toggleClass('tps-gcm-setting-item--invalid', !!diagnostic);
            keySetting.descEl.setText(
              diagnostic?.code === 'blank'
                ? 'A frontmatter key is required. The saved key was not changed.'
                : diagnostic?.code === 'duplicate'
                  ? `Another field already uses "${candidate}" (case-insensitive). The saved key was not changed.`
                  : 'Required. Matching ignores case but preserves punctuation and interior spaces.',
            );
            if (diagnostic) return;
            prop.key = candidate;
            await this.plugin.saveSettings();
          }));
      const persistedKeyDiagnostic = getPropertyKeyDiagnostic(this.plugin.settings.properties, index);
      keySetting.settingEl.toggleClass('tps-gcm-setting-item--invalid', !!persistedKeyDiagnostic);
      const keyInput = keySetting.controlEl.querySelector<HTMLInputElement>('input');
      keyInput?.setAttribute('aria-invalid', persistedKeyDiagnostic ? 'true' : 'false');
      if (persistedKeyDiagnostic?.code === 'blank') {
        keySetting.descEl.setText('This saved field has no key. Enter a unique key to make it usable.');
      } else if (persistedKeyDiagnostic?.code === 'duplicate') {
        keySetting.descEl.setText(`This saved key is also used by ${persistedKeyDiagnostic.duplicateIndexes.length} other field${persistedKeyDiagnostic.duplicateIndexes.length === 1 ? '' : 's'}. Enter a unique key; TPS will not rename it automatically.`);
      }

      // Type
      new Setting(fields)
        .setName('Type')
        .addDropdown(drop => drop
          .addOption('text', 'Text')
          .addOption('number', 'Number')
          .addOption('datetime', 'Date/Time')
          .addOption('selector', 'Selector (Dropdown)')
          .addOption('kind', 'Kind (Entity identity)')
          .addOption('list', 'List')
          .addOption('checkbox', 'Checkbox')
          .addOption('recurrence', 'Recurrence')
          .addOption('folder', 'Folder')
          .addOption('snooze', 'Snooze')
          .setValue(prop.type)
          .onChange(async (value: any) => {
            prop.type = value;
            if (value === 'kind') {
              delete prop.acceptsKind;
              prop.optionSources = getPropertyOptionSources(prop)
                .filter((source) => source !== 'entity');
              prop.allowInlineSet = false;
            } else if (value === 'list' && isEntityOnlyProperty(prop)) {
              prop.listItemType = 'link';
            }
            await this.plugin.saveSettings();
            this.display();
          }));

      if (prop.type !== 'kind') {
        const knownKinds = this.plugin.entityIndexService?.getDimensionValues('kind') || [];
        const acceptedKindsSetting = new Setting(fields)
          .setName('Accepted kinds')
          .setDesc([
            'Optional. Enter one or more Kind identities separated by commas or new lines. First setting accepted Kinds defaults this field to Entities only. Use Value sources below to combine entities with manual or discovered vault values.',
            knownKinds.length > 0 ? `Known: ${knownKinds.slice(0, 8).join(', ')}${knownKinds.length > 8 ? ', …' : ''}` : 'You can name a Kind before matching entities exist.',
          ].join(' '))
          .addTextArea((text) => {
            let committedAcceptedKinds = normalizeAcceptedKindSetting(prop.acceptsKind);
            let draftAcceptedKinds = committedAcceptedKinds;
            let lastAcceptedKindSources = committedAcceptedKinds
              ? getPropertyOptionSources(prop)
              : null;
            const applyAcceptedKindsDraft = (value: unknown): string => {
              const currentAcceptedKinds = normalizeAcceptedKindSetting(prop.acceptsKind);
              if (currentAcceptedKinds) {
                lastAcceptedKindSources = getPropertyOptionSources(prop);
              }
              const previousListItemType = prop.listItemType;
              const nextAcceptedKinds = normalizeAcceptedKindSetting(value);
              applyAcceptedKindSetting(prop, nextAcceptedKinds);
              if (nextAcceptedKinds && lastAcceptedKindSources) {
                prop.optionSources = [...lastAcceptedKindSources];
                prop.optionsSource = prop.optionSources.includes('vault') ? 'vault' : 'manual';
                if (prop.type === 'list' && !isEntityOnlyProperty(prop)) {
                  prop.listItemType = previousListItemType;
                }
              }
              return nextAcceptedKinds;
            };
            const commitAcceptedKinds = async (nextFocus: EventTarget | null): Promise<void> => {
              const nextAcceptedKinds = normalizeAcceptedKindSetting(draftAcceptedKinds);
              const currentAcceptedKinds = normalizeAcceptedKindSetting(prop.acceptsKind);
              if (
                nextAcceptedKinds === committedAcceptedKinds
                && currentAcceptedKinds === committedAcceptedKinds
              ) {
                draftAcceptedKinds = committedAcceptedKinds;
                text.setValue(committedAcceptedKinds);
                return;
              }

              applyAcceptedKindsDraft(nextAcceptedKinds);
              committedAcceptedKinds = normalizeAcceptedKindSetting(prop.acceptsKind);
              draftAcceptedKinds = committedAcceptedKinds;
              text.setValue(committedAcceptedKinds);
              if (valueSettingsHost) {
                const sourceSelectUpdated = this.syncPropertyValueSourceSelect(valueSettingsHost, prop);
                if (!sourceSelectUpdated) {
                  this.refreshCustomPropertyValueSettings(valueSettingsHost, prop);
                } else if (nextFocus instanceof Node && valueSettingsHost.contains(nextFocus)) {
                  this.refreshPropertyValueSettingsWhenFocusLeaves(valueSettingsHost, prop);
                } else {
                  this.refreshCustomPropertyValueSettings(valueSettingsHost, prop);
                }
              }
              await this.plugin.saveSettings();
            };

            text
              .setPlaceholder('project, area')
              .setValue(committedAcceptedKinds)
              .onChange(async (value) => {
                draftAcceptedKinds = value;
                applyAcceptedKindsDraft(value);
                await this.plugin.saveSettings();
              });
            text.inputEl.rows = 2;
            text.inputEl.style.minHeight = '3.5em';
            text.inputEl.style.resize = 'vertical';
            text.inputEl.addEventListener('blur', (event: FocusEvent) => {
              void commitAcceptedKinds(event.relatedTarget);
            });
            text.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                text.inputEl.blur();
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                draftAcceptedKinds = committedAcceptedKinds;
                text.setValue(committedAcceptedKinds);
                text.inputEl.blur();
              }
            });
          });
        acceptedKindsSetting.settingEl.style.gridColumn = '1 / -1';
      }

      // Icon
      new Setting(fields)
        .setName('Icon')
        .addText(text => text
          .setValue(prop.icon || '')
          .setPlaceholder('lucide-icon-name')
          .onChange(async (value) => {
            prop.icon = value;
            await this.plugin.saveSettings();
          }));

      new Setting(fields)
        .setName('Show on inline menu')
        .setDesc('Show this property in the inline header panel')
        .addToggle((toggle) =>
          toggle
            .setValue(prop.showInCollapsed !== false)
            .onChange(async (value) => {
              prop.showInCollapsed = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(fields)
        .setName('Show in context menu')
        .setDesc('Show this property in the right-click context menu')
        .addToggle((toggle) =>
          toggle
            .setValue(prop.showInContextMenu !== false)
            .onChange(async (value) => {
              prop.showInContextMenu = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(fields)
        .setName('Allow @@ inline set')
        .setDesc('Allow this property in the task-line @@ picker. Disable for fields like title, parent, or folder.')
        .addToggle((toggle) =>
          toggle
            .setValue(prop.allowInlineSet !== false)
            .onChange(async (value) => {
              prop.allowInlineSet = value;
              await this.plugin.saveSettings();
            })
        );

      new Setting(fields)
        .setName('Property visibility')
        .setDesc('Default key/value visibility rule for this property. Inline and context menu can override it below.')
        .addDropdown((drop) => drop
          .addOption('always', 'Always show')
          .addOption('populated', 'Only when key has value')
          .addOption('exists', 'Only when key exists')
          .addOption('blank', 'Only when key exists but is empty')
          .addOption('missing', 'Only when key is missing')
          .addOption('empty', 'Only when missing or empty')
          .addOption('never', 'Never show')
          .setValue(prop.hidden === true ? 'never' : prop.showWhen || 'always')
          .onChange(async (value: CustomProperty['showWhen']) => {
            prop.showWhen = value || 'always';
            prop.hidden = value === 'never';
            await this.plugin.saveSettings();
          }));

      new Setting(fields)
        .setName('Inline visibility')
        .setDesc('Optional override for the inline/header property chip. Use this to hide missing keys inline while still showing them in the context menu.')
        .addDropdown((drop) => drop
          .addOption('', 'Use property visibility')
          .addOption('always', 'Always show')
          .addOption('populated', 'Only when key has value')
          .addOption('exists', 'Only when key exists')
          .addOption('blank', 'Only when key exists but is empty')
          .addOption('missing', 'Only when key is missing')
          .addOption('empty', 'Only when missing or empty')
          .addOption('never', 'Never show')
          .setValue(prop.inlineShowWhen || '')
          .onChange(async (value: '' | CustomProperty['showWhen']) => {
            if (value) prop.inlineShowWhen = value;
            else delete prop.inlineShowWhen;
            await this.plugin.saveSettings();
          }));

      new Setting(fields)
        .setName('Context menu visibility')
        .setDesc('Optional override for the right-click context menu.')
        .addDropdown((drop) => drop
          .addOption('', 'Use property visibility')
          .addOption('always', 'Always show')
          .addOption('populated', 'Only when key has value')
          .addOption('exists', 'Only when key exists')
          .addOption('blank', 'Only when key exists but is empty')
          .addOption('missing', 'Only when key is missing')
          .addOption('empty', 'Only when missing or empty')
          .addOption('never', 'Never show')
          .setValue(prop.contextMenuShowWhen || '')
          .onChange(async (value: '' | CustomProperty['showWhen']) => {
            if (value) prop.contextMenuShowWhen = value;
            else delete prop.contextMenuShowWhen;
            await this.plugin.saveSettings();
          }));

      const scopeDiv = div.createDiv();
      scopeDiv.style.gridColumn = '1 / -1';
      new Setting(scopeDiv)
        .setName('Show only for kinds')
        .setDesc('Optional comma/newline list of logical note or line kinds, such as task, exercise, food-entry, or workout-session.')
        .addTextArea((text) => {
          text
            .setPlaceholder('task, workout-session')
            .setValue((prop.scopeKinds || []).join(', '))
            .onChange(async (value) => {
              prop.scopeKinds = value
                .split(/[,\n]/u)
                .map((kind) => kind.trim().toLocaleLowerCase())
                .filter(Boolean);
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 2;
          text.inputEl.cols = 30;
        });

      new Setting(scopeDiv)
        .setName('Hide for kinds')
        .setDesc('Optional comma/newline list. Matching logical note or line kinds never show this property.')
        .addTextArea((text) => {
          text
            .setPlaceholder('area, asset')
            .setValue((prop.excludeKinds || []).join(', '))
            .onChange(async (value) => {
              prop.excludeKinds = value
                .split(/[,\n]/u)
                .map((kind) => kind.trim().toLocaleLowerCase())
                .filter(Boolean);
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 2;
          text.inputEl.cols = 30;
        });

      new Setting(scopeDiv)
        .setName('Show only for tags')
        .setDesc('Optional comma/newline list. When set, this property only appears on notes with matching tags, for example type/shopping-item.')
        .addTextArea((text) => {
          text
            .setPlaceholder('type/task, type/project')
            .setValue((prop.scopeTags || []).join(', '))
            .onChange(async (value) => {
              prop.scopeTags = value
                .split(/[,\n]/)
                .map((tag) => tag.trim().replace(/^#/, ''))
                .filter(Boolean);
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 2;
          text.inputEl.cols = 30;
        });

      new Setting(scopeDiv)
        .setName('Scope matching')
        .setDesc('Any is usually best for type tags. All requires every listed tag.')
        .addDropdown((drop) => drop
          .addOption('any', 'Any listed tag')
          .addOption('all', 'All listed tags')
          .setValue(prop.scopeMode || 'any')
          .onChange(async (value: 'any' | 'all') => {
            prop.scopeMode = value;
            await this.plugin.saveSettings();
          }));

      new Setting(scopeDiv)
        .setName('Hide for tags')
        .setDesc('Optional comma/newline list. Matching notes will not show this property.')
        .addTextArea((text) => {
          text
            .setPlaceholder('type/shopping-item')
            .setValue((prop.excludeTags || []).join(', '))
            .onChange(async (value) => {
              prop.excludeTags = value
                .split(/[,\n]/)
                .map((tag) => tag.trim().replace(/^#/, ''))
                .filter(Boolean);
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 2;
          text.inputEl.cols = 30;
        });

      new Setting(scopeDiv)
        .setName('Show only for folders / paths')
        .setDesc('Optional comma/newline list. Matching is prefix-based and supports *, so _* matches underscore-prefixed folders.')
        .addTextArea((text) => {
          text
            .setPlaceholder('Shopping, Areas/Home')
            .setValue((prop.scopePaths || []).join(', '))
            .onChange(async (value) => {
              prop.scopePaths = value
                .split(/[,\n]/)
                .map((path) => path.trim())
                .filter(Boolean);
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 2;
          text.inputEl.cols = 30;
        });

      new Setting(scopeDiv)
        .setName('Hide for folders / paths')
        .setDesc('Optional comma/newline list. Matching notes will not show this property. Supports *, so _* matches underscore-prefixed folders.')
        .addTextArea((text) => {
          text
            .setPlaceholder('Shopping')
            .setValue((prop.excludePaths || []).join(', '))
            .onChange(async (value) => {
              prop.excludePaths = value
                .split(/[,\n]/)
                .map((path) => path.trim())
                .filter(Boolean);
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 2;
          text.inputEl.cols = 30;
        });

      new Setting(scopeDiv)
        .setName('Show only for properties')
        .setDesc('One condition per line: key=value, key contains value, key exists, key missing, key!=value. Example: type=shopping-item.')
        .addTextArea((text) => {
          text
            .setPlaceholder('type=shopping-item\nobjectType contains shopping')
            .setValue((prop.scopeProperties || []).map((condition) => this.serializePropertyScopeCondition(condition)).join('\n'))
            .onChange(async (value) => {
              prop.scopeProperties = this.parsePropertyScopeConditions(value);
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 3;
          text.inputEl.cols = 30;
        });

      new Setting(scopeDiv)
        .setName('Hide when properties match')
        .setDesc('One condition per line. Any matching logical frontmatter condition hides this field without deleting its value. Example: kind=area hides Status on areas.')
        .addTextArea((text) => {
          text
            .setPlaceholder('kind=area\nworkflowState=archived')
            .setValue((prop.hideWhenProperties || []).map((condition) => this.serializePropertyScopeCondition(condition)).join('\n'))
            .onChange(async (value) => {
              prop.hideWhenProperties = this.parsePropertyScopeConditions(value);
              await this.plugin.saveSettings();
            });
          text.inputEl.rows = 3;
          text.inputEl.cols = 30;
        });

      valueSettingsHost = div.createDiv({ cls: 'tps-gcm-property-value-settings' });
      valueSettingsHost.style.gridColumn = '1 / -1';
      this.renderCustomPropertyValueSettings(valueSettingsHost, prop);

    });
  }

  private renderBaseQueryGuide(container: HTMLElement): void {
    const guide = this.createTrackedSection(
      container,
      'Base query reference',
      'Open a compact query example and choose one reference category at a time.',
      false,
    );

    const dailyNoteCallout = guide.createDiv({ cls: 'tps-gcm-settings-base-query-callout' });
    dailyNoteCallout.createEl('strong', { text: 'Current Daily Note in the Daily Note Feed' });
    dailyNoteCallout.createSpan({
      text: 'Use both path filters, then select GCM row kinds in the active TPS List view: task, bullet, header/heading, or an exact h1–h6. In Home, this.file.path is replaced with the selected Daily Note path.',
    });
    guide.createEl('pre', { cls: 'tps-gcm-settings-base-query-code' })
      .createEl('code', { text: CURRENT_DAILY_NOTE_FEED_QUERY });

    guide.createEl('h4', { text: 'Daily Note Feed targeting notes' });
    const gotchaList = guide.createEl('ul', { cls: 'tps-gcm-settings-base-query-gotchas' });
    BASE_QUERY_GUIDE_GOTCHAS.forEach((note) => gotchaList.createEl('li', { text: note }));

    const selectedSection = BASE_QUERY_GUIDE_SECTIONS.find(
      (section) => section.title === this.activeBaseQuerySection,
    ) || BASE_QUERY_GUIDE_SECTIONS[0];

    new Setting(guide)
      .setName('Reference category')
      .setDesc('Show one query namespace at a time.')
      .addDropdown((dropdown) => {
        dropdown.selectEl.dataset.tpsGcmSettingsBaseQueryCategory = 'true';
        BASE_QUERY_GUIDE_SECTIONS.forEach((section) => {
          dropdown.addOption(section.title, section.title);
        });
        dropdown
          .setValue(selectedSection?.title || '')
          .onChange((value) => {
            const scrollTop = this.containerEl.scrollTop;
            this.activeBaseQuerySection = value;
            this.display();
            this.containerEl.scrollTop = scrollTop;
            this.containerEl
              .querySelector<HTMLSelectElement>('[data-tps-gcm-settings-base-query-category="true"]')
              ?.focus({ preventScroll: true });
          });
      });

    if (selectedSection) {
      guide.createEl('h4', { text: selectedSection.title });
      guide.createEl('p', {
        text: selectedSection.description,
        cls: 'setting-item-description',
      });
      const table = guide.createEl('table', { cls: 'tps-gcm-settings-base-query-reference' });
      const headRow = table.createEl('thead').createEl('tr');
      headRow.createEl('th', { text: 'Variable / expression' });
      headRow.createEl('th', { text: 'Available in' });
      headRow.createEl('th', { text: 'Meaning' });
      const body = table.createEl('tbody');
      selectedSection.entries.forEach((entry) => {
        const row = body.createEl('tr');
        row.createEl('td').createEl('code', { text: entry.expression });
        row.createEl('td', { cls: 'tps-gcm-settings-base-query-scope', text: entry.appliesTo });
        row.createEl('td', { text: entry.description });
      });
    }

    const links = guide.createDiv({ cls: 'tps-gcm-settings-base-query-links' });
    links.createEl('a', {
      text: 'Obsidian Bases syntax reference',
      href: OBSIDIAN_BASES_SYNTAX_URL,
      cls: 'external-link',
      attr: { target: '_blank', rel: 'noopener' },
    });
    links.createEl('a', {
      text: 'Obsidian Bases function reference',
      href: OBSIDIAN_BASES_FUNCTIONS_URL,
      cls: 'external-link',
      attr: { target: '_blank', rel: 'noopener' },
    });
  }

  private renderCustomPropertyValueSettings(
    container: HTMLElement,
    prop: CustomProperty,
  ): void {
    container.empty();
    if (prop.type === 'list') {
      const listOptionsDiv = container.createDiv();
      listOptionsDiv.style.gridColumn = '1 / -1';
      if (isEntityOnlyProperty(prop)) {
        new Setting(listOptionsDiv)
          .setName('List values')
          .setDesc(`Stored as entity links because this property accepts entities matching ${formatAcceptedKindConstraint(prop.acceptsKind)}.`);
      } else {
        new Setting(listOptionsDiv)
          .setName('List values')
          .setDesc('Choose whether this list stores Obsidian tags, plain text strings, or note links.')
          .addDropdown((drop) => {
            drop.selectEl.dataset.tpsGcmPropertyListStorage = 'true';
            drop
              .addOption('tag', 'Tags')
              .addOption('text', 'Text strings')
              .addOption('link', 'Links')
              .setValue(prop.listItemType || 'tag')
              .onChange(async (value: 'tag' | 'text' | 'link') => {
                prop.listItemType = value;
                await this.plugin.saveSettings();
                this.refreshCustomPropertyValueSettings(
                  container,
                  prop,
                  document.activeElement === drop.selectEl ? 'list-storage' : undefined,
                );
              });
          });
      }
    }

    if (
      prop.type === 'selector'
      || prop.type === 'list'
      || prop.type === 'kind'
      || Boolean(prop.acceptsKind)
    ) {
      this.renderPropertyOptionSettings(container, prop, (restoreFocus) => {
        this.refreshCustomPropertyValueSettings(
          container,
          prop,
          restoreFocus ? 'value-sources' : undefined,
        );
      });
    }
  }

  private refreshCustomPropertyValueSettings(
    container: HTMLElement,
    prop: CustomProperty,
    focusControl?: 'value-sources' | 'list-storage',
  ): void {
    const scrollTop = this.containerEl.scrollTop;
    delete container.dataset.tpsGcmPendingValueRefresh;
    this.renderCustomPropertyValueSettings(container, prop);
    this.containerEl.scrollTop = scrollTop;

    const selector = focusControl === 'value-sources'
      ? '[data-tps-gcm-property-value-sources="true"]'
      : focusControl === 'list-storage'
        ? '[data-tps-gcm-property-list-storage="true"]'
        : '';
    if (!selector) return;
    container.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    this.containerEl.scrollTop = scrollTop;
  }

  private refreshPropertyValueSettingsWhenFocusLeaves(
    container: HTMLElement,
    prop: CustomProperty,
  ): void {
    container.dataset.tpsGcmPendingValueRefresh = 'true';
    if (container.dataset.tpsGcmValueRefreshListener === 'true') return;
    container.dataset.tpsGcmValueRefreshListener = 'true';
    container.addEventListener('focusout', (event: FocusEvent) => {
      const nextFocus = event.relatedTarget;
      if (nextFocus instanceof Node && container.contains(nextFocus)) return;
      if (container.dataset.tpsGcmPendingValueRefresh !== 'true') return;
      this.refreshCustomPropertyValueSettings(container, prop);
    });
  }

  private syncPropertyValueSourceSelect(
    container: HTMLElement,
    prop: CustomProperty,
  ): boolean {
    const select = container.querySelector<HTMLSelectElement>(
      '[data-tps-gcm-property-value-sources="true"]',
    );
    if (!select) return false;

    const choices: Array<[string, string]> = [
      ['manual', 'Manual only'],
      ['vault', 'Vault values only'],
      ['manual+vault', 'Manual + vault'],
    ];
    if (prop.type !== 'kind' && normalizeAcceptsKind(prop.acceptsKind).length > 0) {
      choices.push(
        ['entity', 'Entities only'],
        ['manual+entity', 'Manual + entities'],
        ['vault+entity', 'Vault + entities'],
        ['manual+vault+entity', 'Manual + vault + entities'],
      );
    }
    select.replaceChildren(...choices.map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.text = label;
      return option;
    }));
    select.value = encodePropertyOptionSources(getPropertyOptionSources(prop));
    return true;
  }

  private renderPropertyOptionSettings(
    container: HTMLElement,
    prop: CustomProperty,
    refresh: (restoreFocus: boolean) => void,
  ): void {
    const optionsDiv = container.createDiv();
    optionsDiv.style.gridColumn = '1 / -1';
    const vaultOptions = prop.type === 'kind'
      ? this.plugin.entityIndexService?.getDimensionValues('kind') || collectVaultPropertyOptions(this.app, prop)
      : collectVaultPropertyOptions(this.app, prop);
    const manualOptions = normalizeManualPropertyOptions(prop.options || [], prop);
    const effectiveOptions = getEffectivePropertyOptions(this.app, prop);
    const sources = getPropertyOptionSources(prop);
    const sourceValue = encodePropertyOptionSources(sources);
    const normalizedId = String(prop.id || '').trim().toLowerCase();
    const normalizedKey = String(prop.key || '').trim().toLowerCase();
    const relationalStatus = propertyUsesEntityOptions(prop)
      && (normalizedId === 'status' || normalizedKey === 'status');

    new Setting(optionsDiv)
      .setName('Value sources')
      .setDesc(relationalStatus
        ? 'This Status field stores the relationship in status. Task checkbox workflow remains separate as task.status.'
        : 'Combine entered choices, values already used for this property, and indexed entities of the accepted Kinds.')
      .addDropdown((drop) => {
        drop.selectEl.dataset.tpsGcmPropertyValueSources = 'true';
        drop
          .addOption('manual', 'Manual only')
          .addOption('vault', 'Vault values only')
          .addOption('manual+vault', 'Manual + vault');
        if (prop.type !== 'kind' && normalizeAcceptsKind(prop.acceptsKind).length > 0) {
          drop
            .addOption('entity', 'Entities only')
            .addOption('manual+entity', 'Manual + entities')
            .addOption('vault+entity', 'Vault + entities')
            .addOption('manual+vault+entity', 'Manual + vault + entities');
        }
        drop.setValue(sourceValue).onChange(async (value) => {
          prop.optionSources = decodePropertyOptionSources(value);
          prop.optionsSource = prop.optionSources.includes('vault') ? 'vault' : 'manual';
          if (prop.type === 'list' && isEntityOnlyProperty(prop)) prop.listItemType = 'link';
          await this.plugin.saveSettings();
          refresh(document.activeElement === drop.selectEl);
        });
      });

    if (propertyUsesManualOptions(prop)) {
      new Setting(optionsDiv)
        .setName(prop.type === 'selector' || prop.type === 'kind' ? 'Manual options' : 'Manual suggestions')
        .setDesc('Comma or newline separated values. Their order is preserved.')
        .addTextArea((text) => text
          .setValue(manualOptions.join(', '))
          .onChange(async (value) => {
            prop.options = normalizeManualPropertyOptions(value, prop);
            await this.plugin.saveSettings();
          }));
    }

    const preview = optionsDiv.createDiv({ cls: 'setting-item-description' });
    const sourceLabel = propertyUsesVaultOptions(prop)
      ? `${vaultOptions.length} vault value${vaultOptions.length === 1 ? '' : 's'} found`
      : 'Vault values are available after switching the source above';
    preview.createSpan({ text: sourceLabel });
    if (propertyUsesEntityOptions(prop)) {
      preview.createSpan({ text: ` · Entities are limited to ${formatAcceptedKindConstraint(prop.acceptsKind)}.` });
    }
    const chips = optionsDiv.createDiv({ cls: 'tps-gcm-property-options-preview' });
    const displayedOptions = propertyUsesVaultOptions(prop)
      ? effectiveOptions
      : propertyUsesManualOptions(prop)
        ? manualOptions
        : [];
    const previewValues = displayedOptions.slice(0, 18);
    previewValues.forEach((option) => chips.createSpan({ cls: 'tps-gcm-property-option-chip', text: option }));
    if (displayedOptions.length > previewValues.length) {
      chips.createSpan({
        cls: 'tps-gcm-property-option-chip',
        text: `+${displayedOptions.length - previewValues.length}`,
      });
    }
  }

  private renderLinkedSubitemCheckboxSettings(container: HTMLElement): void {
    new Setting(container)
      .setName('Render child-note links as checkboxes')
      .setDesc('Child-note body links render as checkbox rows and sync from the child note status.')
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableLinkedSubitemCheckboxes !== false).onChange(async (v) => {
          this.plugin.settings.enableLinkedSubitemCheckboxes = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(container)
      .setName('Child checkbox style')
      .setDesc('Visual treatment for child-note checkbox rows.')
      .addDropdown((d) =>
        d
          .addOption('native', 'Native')
          .addOption('soft-link', 'Soft link')
          .addOption('accent', 'Accent')
          .setValue(this.plugin.settings.linkedSubitemCheckboxStyle || 'soft-link')
          .onChange(async (value: 'native' | 'soft-link' | 'accent') => {
            this.plugin.settings.linkedSubitemCheckboxStyle = value;
            await this.plugin.saveSettings();
          })
      );

    let fallbackDraft = this.plugin.settings.linkedSubitemDefaultOpenState || '[ ]';
    let mappingsDraft = this.serializeLinkedSubitemMappings(
      normalizeLinkedSubitemMappings(this.plugin.settings.linkedSubitemCheckboxMappings || [], {
        enforceStrictDefaults: true,
      }),
    );
    let fallbackInput: TextComponent | null = null;
    let mappingsInput: TextAreaComponent | null = null;
    let applyButton: ButtonComponent | null = null;
    let validationEl: HTMLElement | null = null;
    const validationId = 'tps-gcm-checkbox-mapping-validation';
    const normalizeWorkflowStatus = (value: unknown): string =>
      this.plugin.sharedServices.status.normalize(value);

    const validateDraft = () => {
      const fallbackState = normalizeLinkedSubitemCheckboxState(fallbackDraft);
      const result = parseLinkedSubitemMappingsText(mappingsDraft, {
        normalizeStatus: normalizeWorkflowStatus,
        completionStatuses: this.plugin.sharedServices.status.getDoneStatuses(),
      });
      const fallbackMapping = fallbackState
        ? result.mappings.find((mapping) => mapping.checkboxState === fallbackState)
        : null;
      const completeStatuses = new Set(
        this.plugin.sharedServices.status.getDoneStatuses().map(normalizeWorkflowStatus),
      );
      const fallbackIsOpen = !!fallbackMapping
        && fallbackState !== '[>]'
        && fallbackMapping.statuses.every((status) => !completeStatuses.has(normalizeWorkflowStatus(status)));
      const errors = [
        ...(fallbackState ? [] : ['Fallback open marker must be [ ] or one checkbox character.']),
        ...(fallbackState && !fallbackMapping ? ['Fallback open marker must be defined by a mapping row.'] : []),
        ...(fallbackMapping && !fallbackIsOpen ? ['Fallback open marker must map only to open statuses.'] : []),
        ...result.errors.map((issue) => `Line ${issue.line}: ${issue.message}`),
      ];
      fallbackInput?.inputEl.setAttribute('aria-invalid', fallbackState ? 'false' : 'true');
      mappingsInput?.inputEl.setAttribute('aria-invalid', result.errors.length === 0 ? 'false' : 'true');
      applyButton?.setDisabled(errors.length > 0);
      if (validationEl) {
        validationEl.empty();
        validationEl.toggleClass('is-error', errors.length > 0);
        validationEl.toggleClass('is-warning', errors.length === 0 && result.warnings.length > 0);
        if (errors.length > 0) {
          validationEl.setText(errors.slice(0, 4).join(' '));
        } else if (result.warnings.length > 0) {
          validationEl.setText(result.warnings.join(' '));
        } else {
          validationEl.setText('Ready to apply. The first row containing a status is its primary marker.');
        }
      }
      return { fallbackState, result, errors };
    };

    const applyMappings = async (): Promise<void> => {
      const validation = validateDraft();
      if (!validation.fallbackState || validation.errors.length > 0) {
        (validation.fallbackState ? mappingsInput?.inputEl : fallbackInput?.inputEl)?.focus();
        return;
      }
      const merged = mergeLinkedSubitemMappingPresentation(
        validation.result.mappings,
        this.plugin.settings.linkedSubitemCheckboxMappings || [],
      );
      this.plugin.settings.linkedSubitemDefaultOpenState = validation.fallbackState;
      this.plugin.settings.linkedSubitemCheckboxMappings = normalizeLinkedSubitemMappings(merged, {
        enforceStrictDefaults: true,
      });
      await this.plugin.saveSettings();
      fallbackDraft = this.plugin.settings.linkedSubitemDefaultOpenState;
      mappingsDraft = this.serializeLinkedSubitemMappings(this.plugin.settings.linkedSubitemCheckboxMappings);
      fallbackInput?.setValue(fallbackDraft);
      mappingsInput?.setValue(mappingsDraft);
      validateDraft();
      new Notice('Checkbox/status mappings applied.');
    };

    const actions = new Setting(container)
      .setName('Checkbox/status mapping changes')
      .setDesc('Draft changes stay local until Apply mappings. Loading defaults also stays a draft until applied.')
      .addButton((button) => {
        applyButton = button;
        button
          .setButtonText('Apply mappings')
          .setCta()
          .onClick(() => void applyMappings());
      })
      .addButton((button) =>
        button
          .setButtonText('Load defaults')
          .onClick(() => {
            fallbackDraft = '[ ]';
            mappingsDraft = this.serializeLinkedSubitemMappings(DEFAULT_LINKED_SUBITEM_MAPPINGS);
            fallbackInput?.setValue(fallbackDraft);
            mappingsInput?.setValue(mappingsDraft);
            validateDraft();
          })
      );
    actions.settingEl.addClass('tps-gcm-settings-checkbox-mapping-actions');

    new Setting(container)
      .setName('Fallback open marker')
      .setDesc('Used only when a linked child note has no workflow status. A nonempty unmapped status remains unsupported. Enter [ ] or one marker character.')
      .addText((text) => {
        fallbackInput = text;
        text
          .setValue(fallbackDraft)
          .onChange((value) => {
            fallbackDraft = value;
            validateDraft();
          });
        text.inputEl.setAttribute('aria-describedby', validationId);
      });

    const mappingEditor = new Setting(container)
      .setName('Child status to checkbox mappings')
      .setDesc('One row per marker: "[ ]: todo => complete". The first status is used when reading the marker; the first row containing a status is used when writing it.')
      .addTextArea((text) => {
        mappingsInput = text;
        text
          .setPlaceholder('[ ]: todo => complete\n[x]: complete => todo\n[/]: working => complete\n[\\]: working => complete\n[?]: holding => todo\n[-]: wont-do => todo\n[>]: migrated => todo')
          .setValue(mappingsDraft)
          .onChange((value) => {
            mappingsDraft = value;
            validateDraft();
          });
        text.inputEl.rows = 9;
        text.inputEl.addClass('tps-gcm-settings-checkbox-mapping-textarea');
        text.inputEl.setAttribute('aria-describedby', validationId);
      });
    mappingEditor.settingEl.addClass('tps-gcm-settings-checkbox-mapping-editor');
    validationEl = mappingEditor.descEl.createDiv({
      attr: {
        id: validationId,
        role: 'status',
        'aria-live': 'polite',
      },
      cls: 'tps-gcm-settings-checkbox-mapping-validation',
    });
    validateDraft();
  }

  private serializeLinkedSubitemMappings(mappings: LinkedSubitemCheckboxMapping[]): string {
    return mappings
      .map((entry) => {
        const statuses = (entry.statuses || []).join(', ');
        const toggle = entry.toggleTargetStatus ? ` => ${entry.toggleTargetStatus}` : '';
        return `${entry.checkboxState}: ${statuses}${toggle}`;
      })
      .join('\n');
  }

  private serializePropertyScopeCondition(condition: NonNullable<CustomProperty['scopeProperties']>[number]): string {
    const key = String(condition?.key || '').trim();
    const value = String(condition?.value || '').trim();
    const operator = String(condition?.operator || 'equals').trim();
    if (!key) return '';
    if (operator === 'exists' || operator === 'missing') return `${key} ${operator}`;
    if (operator === 'contains' || operator === 'not-contains') return `${key} ${operator} ${value}`;
    if (operator === 'not-equals') return `${key}!=${value}`;
    return `${key}=${value}`;
  }

  private parsePropertyScopeConditions(raw: string): NonNullable<CustomProperty['scopeProperties']> {
    return String(raw || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): NonNullable<CustomProperty['scopeProperties']>[number] | null => {
        const existsMatch = line.match(/^([^!=]+?)\s+(exists|missing)$/i);
        if (existsMatch) {
          return { key: existsMatch[1].trim(), value: '', operator: existsMatch[2].toLowerCase() as any };
        }

        const containsMatch = line.match(/^(.+?)\s+(contains|not-contains)\s+(.+)$/i);
        if (containsMatch) {
          return {
            key: containsMatch[1].trim(),
            value: containsMatch[3].trim(),
            operator: containsMatch[2].toLowerCase() as any,
          };
        }

        const notEqualsIndex = line.indexOf('!=');
        if (notEqualsIndex >= 0) {
          return {
            key: line.slice(0, notEqualsIndex).trim(),
            value: line.slice(notEqualsIndex + 2).trim(),
            operator: 'not-equals',
          };
        }

        const equalsIndex = line.indexOf('=');
        if (equalsIndex >= 0) {
          return {
            key: line.slice(0, equalsIndex).trim(),
            value: line.slice(equalsIndex + 1).trim(),
            operator: 'equals',
          };
        }

        return null;
      })
      .filter((condition): condition is NonNullable<CustomProperty['scopeProperties']>[number] => {
        return !!condition && !!String(condition.key || '').trim();
      });
  }

}
