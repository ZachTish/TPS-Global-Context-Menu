import { App, PluginSettingTab, Setting, TextComponent } from 'obsidian';
import type TPSGlobalContextMenuPlugin from './main';
import type { AppearanceSettingKey, CustomProperty, LinkedSubitemCheckboxMapping, ViewModeConditionOperator, ViewModeConditionType, ViewModeRule, ViewModeRuleCondition } from './types';
import { BucketSectionRenderer } from './notebook-navigator-settings/bucket-section';
import { HideSectionRenderer } from './notebook-navigator-settings/hide-section';
import { RulesSectionRenderer } from './notebook-navigator-settings/rules-section';
import type { BindCommittedText, SettingsSectionContext } from './notebook-navigator-settings/ui-common';
import { collectVaultPropertyOptions, getEffectivePropertyOptions, normalizeManualPropertyOptions } from './utils/property-options';
import { mergeLinkedSubitemMappingPresentation } from './utils/linked-subitem-mapping';
import { normalizeParentLinkFormat } from './handlers/parent-link-format';
import {
  BASE_QUERY_GUIDE_GOTCHAS,
  BASE_QUERY_GUIDE_SECTIONS,
  CURRENT_DAILY_NOTE_FEED_QUERY,
  OBSIDIAN_BASES_FUNCTIONS_URL,
  OBSIDIAN_BASES_SYNTAX_URL,
} from './base-query-guide';

const NN_TEXT_COMMIT_DEBOUNCE_MS = 300;
const NN_SETTINGS_STYLE_ID = 'tps-gcm-notebook-navigator-rule-settings-style';

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
  private settingsViewState = new Map<string, boolean>();
  private settingsScrollTop = 0;
  private hasRenderedSettings = false;
  private readonly nnTextCommitTimers = new Map<string, number>();

  constructor(app: App, plugin: TPSGlobalContextMenuPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private getSectionStateKey(parent: HTMLElement, title: string): string {
    return title.trim();
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

  private renderNotebookNavigatorRules(container: HTMLElement, createSection: (parent: HTMLElement, title: string, description?: string, defaultOpen?: boolean) => HTMLElement): void {
    this.ensureNotebookNavigatorSettingsStyles();
    const settings = this.plugin.settings.notebookNavigatorRules;
    const root = createSection(
      container,
      'Auto Frontmatter Modification Rules',
      'Rules and safeguards for automatic GCM frontmatter writes such as icon, color, sort, hidden tags, title/path fields, and child-note metadata.',
      false,
    );

    const automation = createCollapsibleSection(root, 'Rule Automation Toggles and Manual Apply', 'When GCM applies auto frontmatter rule outputs and how to run them on demand.', false);
    new Setting(automation)
      .setName('Enable rule application')
      .setDesc('Allow GCM to write configured frontmatter rule outputs to markdown files.')
      .addToggle((toggle) => toggle.setValue(settings.enabled).onChange(async (value) => {
        settings.enabled = value;
        await this.plugin.saveSettings();
        this.display();
      }));

    if (settings.enabled) {
      new Setting(automation)
        .setName('Auto-apply on file open')
        .setDesc('Evaluate and apply rules when a markdown file becomes active.')
        .addToggle((toggle) => toggle.setValue(settings.autoApplyOnFileOpen).onChange(async (value) => {
          settings.autoApplyOnFileOpen = value;
          await this.plugin.saveSettings();
        }));

      new Setting(automation)
        .setName('Auto-apply on metadata change')
        .setDesc('Evaluate and apply rules after frontmatter changes.')
        .addToggle((toggle) => toggle.setValue(settings.autoApplyOnMetadataChange).onChange(async (value) => {
          settings.autoApplyOnMetadataChange = value;
          await this.plugin.saveSettings();
        }));

      new Setting(automation)
        .setName('Startup vault scan')
        .setDesc('Scan markdown files once after startup.')
        .addToggle((toggle) => toggle.setValue(settings.applyOnStartup).onChange(async (value) => {
          settings.applyOnStartup = value;
          await this.plugin.saveSettings();
        }));

      new Setting(automation)
        .setName('Metadata debounce (ms)')
        .setDesc('Debounce for metadata-change rule application.')
        .addText((text) => {
          text.setPlaceholder('350');
          this.bindNotebookNavigatorCommittedText(text, String(settings.metadataDebounceMs), async (value) => {
            const parsed = Number.parseInt(value, 10);
            settings.metadataDebounceMs = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 5000)) : 350;
          });
        });

      new Setting(automation)
        .setName('Manual apply')
        .setDesc('Apply configured Notebook Navigator rules immediately through GCM.')
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
      const previewBox = automation.createEl('pre', {
        cls: 'tps-nn-preview',
        text: previewText,
      });
      previewBox.setAttr('aria-label', 'Active file rule output preview');
    }

    const overview = root.createDiv({ cls: 'tps-nn-overview-grid' });
    this.renderRuleOverviewCard(overview, 'Sort', `${settings.smartSort.buckets.length} buckets`, settings.smartSort.enabled ? 'Writes ordered sort keys.' : 'Disabled');
    this.renderRuleOverviewCard(overview, 'Tags', `${settings.hideRules.length} rules`, settings.autoRemoveHiddenWhenNoMatch ? 'Managed tags auto-clean.' : 'Manual tags preserved.');
    this.renderRuleOverviewCard(overview, 'Icon + Color', `${settings.rules.length} rules`, 'First matching icon and color win.');

    const frontmatter = createCollapsibleSection(root, 'Managed Icon, Color, and Sort Field Names', 'Metadata keys GCM writes for visual and sorting outputs.', false);
    new Setting(frontmatter)
      .setName('Icon field')
      .setDesc('Frontmatter key GCM uses to store icon value.')
      .addText((text) => {
        text.setPlaceholder('icon');
        this.bindNotebookNavigatorCommittedText(text, settings.frontmatterIconField, async (value) => {
          settings.frontmatterIconField = value.trim().replace(/\s+/g, '') || 'icon';
        }, false, true);
      });

    new Setting(frontmatter)
      .setName('Color field')
      .setDesc('Frontmatter key GCM uses to store color value.')
      .addText((text) => {
        text.setPlaceholder('color');
        this.bindNotebookNavigatorCommittedText(text, settings.frontmatterColorField, async (value) => {
          settings.frontmatterColorField = value.trim().replace(/\s+/g, '') || 'color';
        }, false, true);
      });

    const cleanup = createCollapsibleSection(root, 'No-Match Icon and Color Cleanup', 'Optional GCM removal behavior when no icon or color rules match.', false);
    new Setting(cleanup)
      .setName('Clear icon when no match')
      .setDesc('Remove the icon field when no icon rule matches.')
      .addToggle((toggle) => toggle.setValue(settings.clearIconWhenNoMatch).onChange(async (value) => {
        settings.clearIconWhenNoMatch = value;
        await this.plugin.saveSettings();
        await this.plugin.applyRulesToActiveFile(false);
      }));

    new Setting(cleanup)
      .setName('Clear color when no match')
      .setDesc('Remove the color field when no color rule matches.')
      .addToggle((toggle) => toggle.setValue(settings.clearColorWhenNoMatch).onChange(async (value) => {
        settings.clearColorWhenNoMatch = value;
        await this.plugin.saveSettings();
        await this.plugin.applyRulesToActiveFile(false);
      }));

    const exclusions = createCollapsibleSection(root, 'Rule Write Exclusions', 'Files excluded from Notebook Navigator rule output writes.', false);
    new Setting(exclusions)
      .setName('Rule write exclusions')
      .setDesc('Skip icon/color/sort/hidden rule writes for matching files. One pattern per line; supports exact paths, folder prefixes, wildcards (*), name:<basename>, and re:<regex>.')
      .addTextArea((text) => {
        text
          .setValue(settings.frontmatterWriteExclusions || '')
          .setPlaceholder('System/Templates/\nSystem/*\nname:daily-template\nre:^System/')
          .onChange(async (value) => {
            settings.frontmatterWriteExclusions = value;
            await this.plugin.saveSettings();
          });
      });

    const generalWrites = createCollapsibleSection(root, 'Title, Folder, Timestamp, and Subitem Auto Writes', 'Other automatic frontmatter writes controlled by GCM.', false);
    new Setting(generalWrites)
      .setName('Auto-sync title from filename')
      .setDesc('Keep frontmatter `title` aligned to the current filename on create/open/rename while excluding scheduled date prefixes or suffixes.')
      .addToggle(t => t.setValue(this.plugin.settings.autoSyncTitleFromFilename).onChange(async v => { this.plugin.settings.autoSyncTitleFromFilename = v; await this.plugin.saveSettings(); }));
    new Setting(generalWrites)
      .setName('Sync folderPath frontmatter')
      .setDesc('When enabled, write the note\'s current folder to `folderPath` during create/open/move flows. The Folder custom property can still move notes when this is off.')
      .addToggle(t => t.setValue(this.plugin.settings.autoSaveFolderPath).onChange(async v => { this.plugin.settings.autoSaveFolderPath = v; await this.plugin.saveSettings(); }));
    new Setting(generalWrites)
      .setName('Auto-sync file timestamps')
      .setDesc('Keep created/modified timestamps on note frontmatter and task lines. The modified value ignores GCM\'s own timestamp write to prevent update loops.')
      .addToggle(t => t.setValue(this.plugin.settings.autoSyncFileTimestamps).onChange(async v => { this.plugin.settings.autoSyncFileTimestamps = v; await this.plugin.saveSettings(); }));
    new Setting(generalWrites)
      .setName('Created timestamp key')
      .setDesc('Frontmatter key used for the file creation timestamp.')
      .addText(t => t
        .setValue(this.plugin.settings.dateCreatedFrontmatterKey || 'datecreated')
        .setPlaceholder('datecreated')
        .onChange(async v => {
          this.plugin.settings.dateCreatedFrontmatterKey = String(v || '').trim() || 'datecreated';
          await this.plugin.saveSettings();
        }));
    new Setting(generalWrites)
      .setName('Modified timestamp key')
      .setDesc('Frontmatter key used for the file modified timestamp.')
      .addText(t => t
        .setValue(this.plugin.settings.dateModifiedFrontmatterKey || 'datemodified')
        .setPlaceholder('datemodified')
        .onChange(async v => {
          this.plugin.settings.dateModifiedFrontmatterKey = String(v || '').trim() || 'datemodified';
          await this.plugin.saveSettings();
        }));
    new Setting(generalWrites)
      .setName('Timestamp format')
      .setDesc('Moment.js format used for created/modified timestamp values.')
      .addText(t => t
        .setValue(this.plugin.settings.fileTimestampFormat || 'YYYY-MM-DD HH:mm:ss')
        .setPlaceholder('YYYY-MM-DD HH:mm:ss')
        .onChange(async v => {
          this.plugin.settings.fileTimestampFormat = String(v || '').trim() || 'YYYY-MM-DD HH:mm:ss';
          await this.plugin.saveSettings();
        }));
    new Setting(generalWrites)
      .setName('Apply auto frontmatter rules on subitem create')
      .setDesc('Immediately apply configured GCM frontmatter rules after GCM creates a subitem.')
      .addToggle(t => t.setValue(this.plugin.settings.applyNotebookNavigatorRulesOnSubitemCreate).onChange(async v => { this.plugin.settings.applyNotebookNavigatorRulesOnSubitemCreate = v; await this.plugin.saveSettings(); }));
    new Setting(generalWrites)
      .setName('Global auto-write exclusions')
      .setDesc('Skip non-rule automatic frontmatter writes, such as title, folderPath, timestamps, and daily-note repairs. One pattern per line; supports exact paths, folder prefixes, wildcards (*), name:<basename>, and re:<regex>.')
      .addTextArea(t => t
        .setValue(this.plugin.settings.frontmatterAutoWriteExclusions || '')
        .setPlaceholder('Templates/\nTemplates/*.md\nname:daily-template')
        .onChange(async v => {
          this.plugin.settings.frontmatterAutoWriteExclusions = v;
          await this.plugin.saveSettings();
        }));

    if (!settings.enabled) {
      root.createEl('p', {
        cls: 'setting-item-description',
        text: 'Rule application is disabled. Enable it above to edit sort buckets, tag rules, and icon/color rules.',
      });
      return;
    }

    const ruleJumpBar = root.createDiv({ cls: 'tps-nn-rule-jumpbar' });
    [
      { label: 'Sort buckets', target: 'tps-nn-sort-buckets', count: settings.smartSort.buckets.length },
      { label: 'Tag rules', target: 'tps-nn-tag-rules', count: settings.hideRules.length },
      { label: 'Icon + color', target: 'tps-nn-icon-color-rules', count: settings.rules.length },
    ].forEach((item) => {
      const button = ruleJumpBar.createEl('button', {
        text: `${item.label} (${item.count})`,
        cls: 'tps-nn-jump-button',
      });
      button.type = 'button';
      button.addEventListener('click', () => {
        root.querySelector<HTMLElement>(`#${item.target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    const sectionContext: SettingsSectionContext = {
      plugin: this.plugin,
      bindCommittedText: this.bindNotebookNavigatorCommittedText,
      refresh: () => this.display(),
      persistRuleChange: (applyActive = false) => this.persistNotebookNavigatorRuleChange(applyActive),
    };

    new BucketSectionRenderer(sectionContext).render(root);
    new HideSectionRenderer(sectionContext).render(root);
    new RulesSectionRenderer(sectionContext).render(root);
  }

  private ensureNotebookNavigatorSettingsStyles(): void {
    if (document.getElementById(NN_SETTINGS_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = NN_SETTINGS_STYLE_ID;
    style.textContent = `
      .tps-nn-section {
        margin: 18px 0;
        padding: 14px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: color-mix(in srgb, var(--background-secondary) 60%, transparent);
      }
      .tps-nn-section > h3 { margin: 0 0 6px; scroll-margin-top: 18px; }
      .tps-nn-rule-jumpbar {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 12px 0;
        padding: 8px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-primary);
      }
      .tps-nn-jump-button {
        min-height: 30px;
        border-radius: 8px;
        white-space: nowrap;
      }
      .tps-nn-toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 14px; align-items: center; }
      .tps-nn-preview {
        margin: 10px 0 14px;
        padding: 10px 12px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-primary);
        color: var(--text-muted);
        white-space: pre-wrap;
        font-size: 12px;
      }
      .tps-nn-overview-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin: 10px 0 16px;
      }
      .tps-nn-overview-card {
        padding: 10px 12px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-primary);
      }
      .tps-nn-overview-title {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-weight: 700;
      }
      .tps-nn-overview-count {
        color: var(--text-accent);
        white-space: nowrap;
      }
      .tps-nn-overview-desc {
        margin-top: 4px;
        color: var(--text-muted);
        font-size: 12px;
      }
      .tps-nn-split { display: grid; grid-template-columns: minmax(250px, 340px) minmax(0, 1fr); gap: 12px; align-items: start; }
      .tps-nn-list-pane { display: flex; flex-direction: column; gap: 8px; max-height: min(72vh, 760px); overflow: auto; padding-right: 2px; }
      .tps-nn-filter-input, .tps-nn-condition-field input, .tps-nn-condition-field select {
        width: 100%;
        min-height: 30px;
        border-radius: 8px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        color: var(--text-normal);
        padding: 0 8px;
      }
      .tps-nn-editor-pane, .tps-nn-list-item, .tps-nn-condition-card {
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-primary);
      }
      .tps-nn-editor-pane { padding: 12px; max-height: min(72vh, 760px); overflow: auto; }
      .tps-nn-list-item { width: 100%; padding: 9px 10px; text-align: left; cursor: pointer; }
      .tps-nn-list-item:hover { border-color: var(--background-modifier-border-hover); background: var(--background-secondary); }
      .tps-nn-list-item.is-active { border-color: var(--interactive-accent); box-shadow: inset 0 0 0 1px var(--interactive-accent); }
      .tps-nn-list-item-title-row, .tps-nn-inline-actions, .tps-nn-badge-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .tps-nn-list-item-icon { display: inline-flex; width: 18px; height: 18px; align-items: center; justify-content: center; flex-shrink: 0; }
      .tps-nn-list-item-icon svg { width: 16px; height: 16px; }
      .tps-nn-list-item-title { font-weight: 700; color: var(--text-accent); }
      .tps-nn-list-item-title.is-muted, .tps-nn-list-item-summary, .tps-nn-summary { color: var(--text-muted); }
      .tps-nn-list-item-summary { margin-top: 3px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tps-nn-list-item-meta { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
      .tps-nn-mini-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 100%;
        padding: 1px 6px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 999px;
        color: var(--text-muted);
        font-size: 11px;
        line-height: 1.5;
      }
      .tps-nn-mini-chip svg { width: 12px; height: 12px; }
      .tps-nn-color-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        border: 1px solid var(--background-modifier-border);
        flex: 0 0 auto;
      }
      .tps-nn-badge { padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; background: var(--background-modifier-border-hover); color: var(--text-muted); }
      .tps-nn-condition-card { padding: 6px; margin: 8px 0; background: color-mix(in srgb, var(--background-secondary) 55%, transparent); }
      .tps-nn-condition-grid { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(110px, 1fr) minmax(120px, 1.3fr) minmax(160px, 2fr) auto; gap: 8px; align-items: center; }
      .tps-nn-condition-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .tps-nn-condition-field label { display: block; font-size: 11px; color: var(--text-muted); }
      .tps-nn-sub-collapsible { margin: 10px 0; border: 1px dashed var(--background-modifier-border); border-radius: 8px; }
      .tps-nn-sub-collapsible > h5, .tps-nn-sub-collapsible > summary { margin: 0; padding: 8px; color: var(--text-muted); font-weight: 600; }
      .tps-nn-sub-body { padding: 0 8px 8px; }
      .tps-nn-callout { margin: 10px 0; padding: 8px 10px; border-left: 3px solid var(--interactive-accent); background: color-mix(in srgb, var(--interactive-accent) 10%, transparent); border-radius: 6px; font-size: 12px; color: var(--text-muted); }
      .tps-gcm-property-options-preview {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 6px 0 0;
      }
      .tps-gcm-property-option-chip {
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--background-modifier-border-hover);
        color: var(--text-muted);
        font-size: 12px;
      }
      @media (max-width: 900px) {
        .tps-nn-split, .tps-nn-condition-grid, .tps-nn-overview-grid { grid-template-columns: 1fr; }
        .tps-nn-list-pane, .tps-nn-editor-pane { max-height: none; }
      }
      .tps-base-query-callout {
        margin: 8px 0 14px;
        padding: 12px 14px;
        border: 1px solid var(--background-modifier-border);
        border-left: 3px solid var(--interactive-accent);
        border-radius: 8px;
        background: var(--background-secondary);
      }
      .tps-base-query-callout strong {
        display: block;
        margin-bottom: 4px;
      }
      .tps-base-query-code {
        margin: 8px 0 14px;
        padding: 12px 14px;
        overflow-x: auto;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background: var(--background-primary-alt);
        font-size: var(--font-ui-smaller);
        line-height: 1.45;
        white-space: pre;
      }
      .tps-base-query-reference {
        width: 100%;
        margin-top: 8px;
        border-collapse: collapse;
        font-size: var(--font-ui-smaller);
      }
      .tps-base-query-reference th,
      .tps-base-query-reference td {
        padding: 8px 10px;
        border-bottom: 1px solid var(--background-modifier-border);
        text-align: left;
        vertical-align: top;
      }
      .tps-base-query-reference th {
        color: var(--text-muted);
        font-weight: var(--font-semibold);
      }
      .tps-base-query-reference th:first-child,
      .tps-base-query-reference td:first-child {
        width: 24%;
        min-width: 142px;
      }
      .tps-base-query-reference th:nth-child(2),
      .tps-base-query-reference td:nth-child(2) {
        width: 22%;
        min-width: 134px;
      }
      .tps-base-query-reference code {
        white-space: normal;
        overflow-wrap: normal;
        word-break: normal;
      }
      .tps-base-query-scope {
        color: var(--text-muted);
        white-space: nowrap;
      }
      .tps-base-query-gotchas {
        margin: 8px 0 14px;
        padding-left: 22px;
      }
      .tps-base-query-gotchas li + li {
        margin-top: 6px;
      }
      .tps-base-query-links {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        margin-top: 12px;
      }
      @media (max-width: 700px) {
        .tps-base-query-reference thead { display: none; }
        .tps-base-query-reference,
        .tps-base-query-reference tbody,
        .tps-base-query-reference tr,
        .tps-base-query-reference td { display: block; width: 100%; }
        .tps-base-query-reference tr {
          padding: 8px 0;
          border-bottom: 1px solid var(--background-modifier-border);
        }
        .tps-base-query-reference td { min-width: 0; padding: 3px 0; border: 0; }
        .tps-base-query-scope { white-space: normal; }
      }
    `;
    document.head.appendChild(style);
  }

  private renderRuleOverviewCard(container: HTMLElement, title: string, count: string, description: string): void {
    const card = container.createDiv({ cls: 'tps-nn-overview-card' });
    const titleRow = card.createDiv({ cls: 'tps-nn-overview-title' });
    titleRow.createSpan({ text: title });
    titleRow.createSpan({ cls: 'tps-nn-overview-count', text: count });
    card.createDiv({ cls: 'tps-nn-overview-desc', text: description });
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
    this.captureSettingsViewState(containerEl);

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

    const createSection = (parent: HTMLElement, title: string, description?: string, defaultOpen = false): HTMLElement =>
      this.createTrackedSection(parent, title, description, defaultOpen);

    const createPopout = (parent: HTMLElement, title: string, description?: string, defaultOpen = false): HTMLElement =>
      this.createTrackedSection(parent, title, description, defaultOpen);

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

    this.renderNotebookNavigatorRules(containerEl, createSection);

    // --- General Settings ---
    const general = createSection(
      containerEl,
      'Context Menu Placement, Base Link Preview, and View Scope',
      'Vault-wide defaults, menu placement, task hiding, and view coverage.',
      false
    );

    // Default paths for new items
    new Setting(general)
      .setName('Default attachments path')
      .setDesc('Folder where new attachment notes are created (plus button). Leave empty to use vault root.')
      .addText((text) =>
        text
          .setPlaceholder('e.g., Attachments or Notes/Attachments')
          .setValue(this.plugin.settings.defaultAttachmentsPath)
          .onChange(async (value) => {
            this.plugin.settings.defaultAttachmentsPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(general)
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

    new Setting(general)
      .setName('Force previews for Base links')
      .setDesc('When enabled, note links in Calendar, Kanban, TPS List, and TPS Table open a Hover Editor preview on first click, then open the note on second click. Leave disabled for normal Notebook Navigator and note-opening behavior.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableBasesForcedLinkPreview === true)
          .onChange(async (value) => {
            this.plugin.settings.enableBasesForcedLinkPreview = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(general)
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

    new Setting(general)
      .setName('Home calendar Base path')
      .setDesc('Base file rendered by the Calendar component in TPS Home.')
      .addText((text) =>
        text
          .setPlaceholder('home-schedule.base')
          .setValue(this.plugin.settings.homeCalendarBasePath || 'home-schedule.base')
          .onChange(async (value) => {
            this.plugin.settings.homeCalendarBasePath = value.trim() || 'home-schedule.base';
            await this.plugin.saveSettings();
          })
      );

    new Setting(general)
      .setName('Home food Base path')
      .setDesc('Base file rendered by the Food tracker component in TPS Home.')
      .addText((text) =>
        text
          .setPlaceholder('Food Log.base')
          .setValue(this.plugin.settings.homeFoodBasePath || 'Food Log.base')
          .onChange(async (value) => {
            this.plugin.settings.homeFoodBasePath = value.trim() || 'Food Log.base';
            await this.plugin.saveSettings();
          })
      );

    new Setting(general)
      .setName('Home activity Base path')
      .setDesc('Base file rendered by the Activity log component in TPS Home.')
      .addText((text) =>
        text
          .setPlaceholder('Activity Log.base')
          .setValue(this.plugin.settings.homeWorkoutBasePath || 'Activity Log.base')
          .onChange(async (value) => {
            this.plugin.settings.homeWorkoutBasePath = value.trim() || 'Activity Log.base';
            await this.plugin.saveSettings();
          })
      );

    new Setting(general)
      .setName('Home open tasks Base path')
      .setDesc('Base file rendered by the Open unscheduled tasks component in TPS Home.')
      .addText((text) =>
        text
          .setPlaceholder('Open Unscheduled Tasks.base')
          .setValue(this.plugin.settings.homeOpenTasksBasePath || 'Open Unscheduled Tasks.base')
          .onChange(async (value) => {
            this.plugin.settings.homeOpenTasksBasePath = value.trim() || 'Open Unscheduled Tasks.base';
            await this.plugin.saveSettings();
          })
      );

    new Setting(general)
      .setName('Home capture position')
      .setDesc('Where TPS Home quick capture inserts new lines in the daily note.')
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

    // Consolidated Scope Settings
    new Setting(general)
      .setName('Enable in specific views')
      .setDesc('Toggle where the custom context menu should appear.')
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

    const inlineUi = createSection(
      containerEl,
      'Inline Menu, Title Icon, and Parent Navigation',
      'Controls for the persistent inline menu, title icon, and top parent navigation.',
      false
    );



    new Setting(inlineUi)
      .setName('Show inline context menu')
      .setDesc('Master toggle for the persistent inline UI. Turn this off to hide the inline bar, title icon, and top parent nav.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableInlinePersistentMenus).onChange(async (value) => {
          this.plugin.settings.enableInlinePersistentMenus = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (this.plugin.settings.enableInlinePersistentMenus) {
      new Setting(inlineUi)
        .setName('Inline menu only')
        .setDesc('Disable TPS additions in native/right-click menus and keep the plugin limited to inline persistent surfaces.')
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings.inlineMenuOnly).onChange(async (value) => {
            this.plugin.settings.inlineMenuOnly = value;
            await this.plugin.saveSettings();
          }),
        );
    } else {
      inlineUi.createEl('p', {
        text: 'Inline UI is disabled. Enable the master toggle to configure the inline bar, title icon, and top parent navigation.',
        cls: 'setting-item-description',
      });
    }

    // --- Appearance Settings ---
    const appearance = createSection(containerEl, 'Inline Menu, Daily Navigation, and Modal Sizing');
    appearance.createEl('p', {
      text: 'Use the cloud/monitor button on each row to switch between synced and this-device-only behavior.',
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


    // --- Custom Property Configuration ---
    const propertyConfig = createSection(
      containerEl,
      'Custom Property Definitions, Options, and Field Behavior',
      'Define editable frontmatter fields and per-property behavior. Placement toggles live under the custom property display section.',
      false
    );

    propertyConfig.createEl('p', {
      text: `${(this.plugin.settings.properties || []).length} properties configured. Use the custom property display section to choose where they appear.`,
      cls: 'setting-item-description',
    });

    const propertiesConfigContainer = propertyConfig.createDiv();
    this.renderProperties(propertiesConfigContainer);
    new Setting(propertyConfig)
      .addButton(btn => btn.setButtonText('Add Property').setCta().onClick(async () => {
        this.plugin.settings.properties.push({ id: Date.now().toString(), label: 'New Property', key: 'new_prop', type: 'text' });
        await this.plugin.saveSettings();
        this.display();
      }));

    // --- View Mode Settings ---
    const viewMode = createSection(
      containerEl,
      'Automatic View Mode Field, Ignored Folders, and Rules',
      'Frontmatter key, ignored folders, and automatic rules. Master toggles live under the note workflow toggles section.',
      false
    );

    if (!this.plugin.settings.enableViewModeSwitching) {
      viewMode.createEl('p', {
        text: 'Automatic view mode switching is off. Re-enable it under the note workflow toggles section to edit the frontmatter key, ignored folders, and rules.',
        cls: 'setting-item-description',
      });
    }

    const viewModeConfigContainer = viewMode.createDiv();
    let viewRulesPopout: HTMLElement = viewModeConfigContainer;

    if (this.plugin.settings.enableViewModeSwitching) {
      new Setting(viewModeConfigContainer)
        .setName('Frontmatter Key')
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
        .setName('Ignored Folders')
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

      viewRulesPopout = createSection(
        viewModeConfigContainer,
        'View Mode Rules',
        'Define condition rules with AND/OR matching (path contains, scheduled past, daily-note date rules, etc).'
      );
    }

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

    if (this.plugin.settings.enableViewModeSwitching) {
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
          const conditionRow = card.createDiv();
          conditionRow.style.display = 'grid';
          conditionRow.style.gridTemplateColumns = 'minmax(110px, 1fr) minmax(110px, 1fr) minmax(120px, 1.3fr) minmax(160px, 2fr) auto';
          conditionRow.style.gap = '8px';
          conditionRow.style.alignItems = 'center';
          conditionRow.style.marginTop = '8px';

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

    // --- Menu Configuration (Consolidated) ---
    const menuConfig = createSection(
      containerEl,
      'Custom Property Display in Inline UI and Context Menus',
      'Controls for how custom properties and colored tags appear in the menu surfaces.',
      false
    );
    const propertiesPopout = createSection(
      menuConfig,
      'Custom Properties',
      'Feature toggles only. Define labels, keys, types, options, and per-property placement under the custom property definitions section.'
    );

    propertiesPopout.createEl('p', {
      text: `${(this.plugin.settings.properties || []).length} properties configured in the custom property definitions section.`,
      cls: 'setting-item-description',
    });

    new Setting(propertiesPopout)
      .setName('Show custom properties in inline UI')
      .setDesc('Display configured custom properties in the inline header/context strip.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showCustomPropertiesInInlineUi !== false)
        .onChange(async (value) => {
          this.plugin.settings.showCustomPropertiesInInlineUi = value;
          await this.plugin.saveSettings();
          this.plugin.persistentMenuManager.ensureMenus();
        }));

    new Setting(propertiesPopout)
      .setName('Stack custom properties under title')
      .setDesc('Show configured inline properties as a stacked section under the note title/top buttons instead of in the bottom inline strip.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showCustomPropertiesUnderTitle === true)
        .onChange(async (value) => {
          this.plugin.settings.showCustomPropertiesUnderTitle = value;
          await this.plugin.saveSettings();
          this.plugin.persistentMenuManager.ensureMenus();
        }));

    new Setting(propertiesPopout)
      .setName('Default stacked properties closed')
      .setDesc('When stacked properties are shown under the title, newly opened notes start with the Properties section collapsed.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.defaultStackedPropertiesClosed === true)
        .onChange(async (value) => {
          this.plugin.settings.defaultStackedPropertiesClosed = value;
          await this.plugin.saveSettings();
          this.plugin.persistentMenuManager.ensureMenus();
        }));

    new Setting(propertiesPopout)
      .setName('Show custom properties in context menu')
      .setDesc('Display configured custom properties in the right-click context menu.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showCustomPropertiesInContextMenu !== false)
        .onChange(async (value) => {
          this.plugin.settings.showCustomPropertiesInContextMenu = value;
          await this.plugin.saveSettings();
        }));

    new Setting(propertiesPopout)
      .setName('Inherit Notebook Navigator tag colors')
      .setDesc('When enabled, tag chips in the inline menu adopt Notebook Navigator tag colors if available.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.inheritNotebookNavigatorTagColors !== false)
        .onChange(async (value) => {
          this.plugin.settings.inheritNotebookNavigatorTagColors = value;
          await this.plugin.saveSettings();
        }));

    // --- Automation Features (Consolidated) ---
    const automation = createSection(
      containerEl,
      'Task Lines, Recurrence, Time Tracking, and Note Navigation',
      'Task, relationship, recurrence, navigation, and time-tracking controls that still belong in GCM.',
      false
    );

    automation.createEl('p', {
      text: 'These settings control note interactions. Controller-owned scheduling and legacy maintenance features are intentionally hidden from this page.',
      cls: 'setting-item-description'
    });

    const timeTracking = createSection(
      automation,
      'Time Tracking',
      'Start/stop timers and store session blocks through the GCM time tracking service.',
      false
    );

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
        .setDesc('Choose where new note-level sessions are written.')
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

    const taskAutomation = createSection(
      automation,
      'Task Lines',
      'Task lines are inline items. Recurrence creates a fresh task instance; linked child-note identity stays on the child note.',
      false,
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
      .setName('Hide completed checkbox lines')
      .setDesc('Hide checked task lines and cancelled task lines like - [x] and - [-] in reading view and live preview. Source mode stays unchanged, and live preview includes a temporary reveal button.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideCompletedCheckboxes === true)
          .onChange(async (value) => {
            this.plugin.settings.hideCompletedCheckboxes = value;
            await this.plugin.saveSettings();
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

    const relationshipAutomation = createSection(
      automation,
      'Child Notes',
      'Child notes keep their own identity. Parent notes only store links to those children in the body.',
      false,
    );
    new Setting(relationshipAutomation).setName('Child parent property key').setDesc('Frontmatter key used on child notes to store parent links. Multiple parents are stored as an array under this key. Legacy parent/parents/childOf values are still read and migrated on write.').addText(t => t.setValue(this.plugin.settings.parentLinkFrontmatterKey || 'parent').onChange(async v => { this.plugin.settings.parentLinkFrontmatterKey = v.trim() || 'parent'; await this.plugin.saveSettings(); }));
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
    new Setting(relationshipAutomation).setName('Show page connections navigation').setDesc('Show a navigation button for incoming and outgoing links.').addToggle(t => t.setValue(this.plugin.settings.enableTopParentNav).onChange(async v => { this.plugin.settings.enableTopParentNav = v; await this.plugin.saveSettings(); this.plugin.persistentMenuManager.ensureMenus(); }));
    new Setting(relationshipAutomation)
      .setName('Connections button placement')
      .setDesc('Move the mentions, parents, and children buttons either below the title or into the bottom note toolbar.')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('top', 'Below title')
          .addOption('bottom', 'Bottom toolbar')
          .setValue(this.plugin.settings.topParentNavPlacement || 'top')
          .onChange(async (value: 'top' | 'bottom') => {
            this.plugin.settings.topParentNavPlacement = value;
            await this.plugin.saveSettings();
            this.plugin.persistentMenuManager.ensureMenus();
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

    const advancedAutomation = createSection(
      automation,
      'Recurrence',
      [
        hasController ? 'Prefer TPS Controller for recurring/archive orchestration.' : '',
      ].filter(Boolean).join(' ')
    );
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

    const viewModeFeatures = createSection(
      automation,
      'Automatic and Manual View Mode Toggles',
      'Feature toggles only. Rule/frontmatter configuration lives under the automatic view mode rules section.'
    );
    new Setting(viewModeFeatures)
      .setName('Enable automatic view mode switching')
      .setDesc('Automatically switch between Source, Live Preview, and Reading modes based on frontmatter and configured rules.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableViewModeSwitching)
          .onChange(async (value) => {
            this.plugin.settings.enableViewModeSwitching = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    new Setting(viewModeFeatures)
      .setName('Show inline manual view mode controls')
      .setDesc('Show Reading / Live / Source buttons in the inline menu panel only.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableInlineManualViewMode)
          .onChange(async (value) => {
            this.plugin.settings.enableInlineManualViewMode = value;
            await this.plugin.saveSettings();
          })
      );

    const navigationAutomation = createSection(
      automation,
      'Daily Note Navigation and Scheduled Task Inheritance',
      'Controls for the Previous, Today, Next, and week navigation overlay on daily notes.',
      true,
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

    const diagnostics = createSection(
      containerEl,
      'Debug Logging',
      'Low-frequency troubleshooting settings.',
      false
    );

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

    this.renderBaseQueryGuide(containerEl, createSection);

    containerEl.createEl('p', {
      text: 'Note: native context menu items are preserved; TPS actions are injected when context targets match.',
      cls: 'setting-item-description',
      attr: { style: 'margin-top: 20px; text-align: center; opacity: 0.7;' }
    });
    this.restoreSettingsViewState(containerEl);
  }

  private captureSettingsViewState(containerEl: HTMLElement): void {
    this.settingsScrollTop = containerEl.scrollTop;
    this.settingsViewState.clear();
    const detailsEls = Array.from(containerEl.querySelectorAll('details'));
    detailsEls.forEach((detailsEl, index) => {
      const details = detailsEl as HTMLDetailsElement;
      const summaryText = details.querySelector('summary')?.textContent?.trim() || '';
      this.settingsViewState.set(`${index}:${summaryText}`, details.open);
    });
  }

  private restoreSettingsViewState(containerEl: HTMLElement): void {
    const detailsEls = Array.from(containerEl.querySelectorAll('details'));
    if (!this.hasRenderedSettings) {
      detailsEls.forEach((detailsEl) => {
        (detailsEl as HTMLDetailsElement).removeAttribute('open');
      });
      this.hasRenderedSettings = true;
      containerEl.scrollTop = 0;
      return;
    }
    detailsEls.forEach((detailsEl, index) => {
      const details = detailsEl as HTMLDetailsElement;
      const summaryText = details.querySelector('summary')?.textContent?.trim() || '';
      const isOpen = this.settingsViewState.get(`${index}:${summaryText}`);
      if (isOpen) details.setAttr('open', 'true');
      else details.removeAttribute('open');
    });
    containerEl.scrollTop = this.settingsScrollTop;
  }

  renderProperties(container: HTMLElement) {
    container.empty();

    // Ensure properties exists
    if (!this.plugin.settings.properties) {
      this.plugin.settings.properties = [];
    }

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
      new Setting(fields)
        .setName('Frontmatter Key')
        .addText(text => text
          .setValue(prop.key)
          .onChange(async (value) => {
            prop.key = value;
            await this.plugin.saveSettings();
          }));

      // Type
      new Setting(fields)
        .setName('Type')
        .addDropdown(drop => drop
          .addOption('text', 'Text')
          .addOption('number', 'Number')
          .addOption('datetime', 'Date/Time')
          .addOption('selector', 'Selector (Dropdown)')
          .addOption('list', 'List')
          .addOption('checkbox', 'Checkbox')
          .addOption('recurrence', 'Recurrence')
          .addOption('folder', 'Folder')
          .addOption('snooze', 'Snooze')
          .setValue(prop.type)
          .onChange(async (value: any) => {
            prop.type = value;
            await this.plugin.saveSettings();
            this.display();
          }));

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

      if (prop.type === 'list') {
        const listOptionsDiv = div.createDiv();
        listOptionsDiv.style.gridColumn = '1 / -1';
        new Setting(listOptionsDiv)
          .setName('List values')
          .setDesc('Choose whether this list stores Obsidian tags, plain text strings, or note links.')
          .addDropdown((drop) => drop
            .addOption('tag', 'Tags')
            .addOption('text', 'Text strings')
            .addOption('link', 'Links')
            .setValue(prop.listItemType || 'tag')
            .onChange(async (value: 'tag' | 'text' | 'link') => {
              prop.listItemType = value;
              await this.plugin.saveSettings();
              this.display();
            }));
      }

      if (prop.type === 'selector' || prop.type === 'list') {
        this.renderPropertyOptionSettings(div, prop);
      }

    });
  }

  private renderBaseQueryGuide(
    container: HTMLElement,
    createSection: (parent: HTMLElement, title: string, description?: string, defaultOpen?: boolean) => HTMLElement,
  ): void {
    const guide = createSection(
      container,
      'Base query guide',
      'GCM custom view contracts first, followed by Daily Note targeting, synthesized row fields, and native Obsidian Base properties.',
      true,
    );

    const dailyNoteCallout = guide.createDiv({ cls: 'tps-base-query-callout' });
    dailyNoteCallout.createEl('strong', { text: 'Current Daily Note in the Daily Note Feed' });
    dailyNoteCallout.createSpan({
      text: 'Use both path filters, then select GCM row kinds in the active TPS List view: task, bullet, header/heading, or an exact h1–h6. In Home, this.file.path is replaced with the selected Daily Note path.',
    });
    guide.createEl('pre', { cls: 'tps-base-query-code' })
      .createEl('code', { text: CURRENT_DAILY_NOTE_FEED_QUERY });

    const gotchas = createCollapsibleSection(
      guide,
      'Daily Note Feed targeting notes',
      'The important distinctions behind the current feed query.',
      true,
    );
    const gotchaList = gotchas.createEl('ul', { cls: 'tps-base-query-gotchas' });
    BASE_QUERY_GUIDE_GOTCHAS.forEach((note) => gotchaList.createEl('li', { text: note }));

    BASE_QUERY_GUIDE_SECTIONS.forEach((section) => {
      const sectionBody = createCollapsibleSection(
        guide,
        section.title,
        section.description,
        section.defaultOpen === true,
      );
      const table = sectionBody.createEl('table', { cls: 'tps-base-query-reference' });
      const headRow = table.createEl('thead').createEl('tr');
      headRow.createEl('th', { text: 'Variable / expression' });
      headRow.createEl('th', { text: 'Available in' });
      headRow.createEl('th', { text: 'Meaning' });
      const body = table.createEl('tbody');
      section.entries.forEach((entry) => {
        const row = body.createEl('tr');
        row.createEl('td').createEl('code', { text: entry.expression });
        row.createEl('td', { cls: 'tps-base-query-scope', text: entry.appliesTo });
        row.createEl('td', { text: entry.description });
      });
    });

    const links = guide.createDiv({ cls: 'tps-base-query-links' });
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

  private renderPropertyOptionSettings(container: HTMLElement, prop: CustomProperty): void {
    const optionsDiv = container.createDiv();
    optionsDiv.style.gridColumn = '1 / -1';
    const vaultOptions = collectVaultPropertyOptions(this.app, prop);
    const manualOptions = normalizeManualPropertyOptions(prop.options || [], prop);
    const effectiveOptions = getEffectivePropertyOptions(this.app, prop);

    new Setting(optionsDiv)
      .setName('Option source')
      .setDesc('Manual values are always kept; vault values are discovered from existing markdown frontmatter for this key.')
      .addDropdown((drop) => drop
        .addOption('manual', 'Manual values only')
        .addOption('vault', 'Manual + vault values')
        .setValue(prop.optionsSource || 'manual')
        .onChange(async (value: 'manual' | 'vault') => {
          prop.optionsSource = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(optionsDiv)
      .setName(prop.type === 'selector' ? 'Manual options' : 'Manual suggestions')
      .setDesc('Comma or newline separated values. These are merged with vault values when the option source includes the vault.')
      .addTextArea((text) => text
        .setValue(manualOptions.join(', '))
        .onChange(async (value) => {
          prop.options = normalizeManualPropertyOptions(value, prop);
          await this.plugin.saveSettings();
        }));

    const preview = optionsDiv.createDiv({ cls: 'setting-item-description' });
    const sourceLabel = prop.optionsSource === 'vault'
      ? `${vaultOptions.length} vault value${vaultOptions.length === 1 ? '' : 's'} found`
      : 'Vault values are available after switching the source above';
    preview.createSpan({ text: sourceLabel });
    const chips = optionsDiv.createDiv({ cls: 'tps-gcm-property-options-preview' });
    const displayedOptions = prop.optionsSource === 'vault' ? effectiveOptions : manualOptions;
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

    new Setting(container)
      .setName('Fallback open marker')
      .setDesc('Checkbox token used when no child status mapping matches.')
      .addText((t) =>
        t.setValue(this.plugin.settings.linkedSubitemDefaultOpenState || '[ ]')
          .onChange(async (v) => {
            this.plugin.settings.linkedSubitemDefaultOpenState = v.trim() || '[ ]';
            await this.plugin.saveSettings();
          })
      );

    new Setting(container)
      .setName('Child status to checkbox mappings')
      .setDesc('One mapping per line: "[ ]: todo => complete". Left side is the visual checkbox, right side is the status written when toggled.')
      .addTextArea((t) =>
        t
          .setPlaceholder('[ ]: todo => complete\n[x]: complete => todo\n[\\\\]: working => complete\n[?]: holding => todo\n[-]: wont-do => todo')
          .setValue(this.serializeLinkedSubitemMappings(this.plugin.settings.linkedSubitemCheckboxMappings || []))
          .onChange(async (v) => {
            const parsed = this.parseLinkedSubitemMappings(v);
            const fallback = this.parseLinkedSubitemMappings('[ ]: todo => complete\n[x]: complete => todo\n[\\\\]: working => complete\n[?]: holding => todo\n[-]: wont-do => todo');
            const nextMappings = parsed.length > 0 ? parsed : fallback;
            this.plugin.settings.linkedSubitemCheckboxMappings = mergeLinkedSubitemMappingPresentation(
              nextMappings,
              this.plugin.settings.linkedSubitemCheckboxMappings || [],
            );
            await this.plugin.saveSettings();
          })
      );
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

  private parseLinkedSubitemMappings(raw: string): LinkedSubitemCheckboxMapping[] {
    return String(raw || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): LinkedSubitemCheckboxMapping | null => {
        const [left, togglePart] = line.split(/\s*=>\s*/, 2);
        const colonIndex = left.indexOf(':');
        if (colonIndex < 0) return null;
        const checkboxState = left.slice(0, colonIndex).trim();
        const statuses = left
          .slice(colonIndex + 1)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        if (!checkboxState || statuses.length === 0) return null;
        return {
          checkboxState,
          statuses,
          toggleTargetStatus: togglePart?.trim() || undefined,
        };
      })
      .filter((entry): entry is LinkedSubitemCheckboxMapping => entry !== null);
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
