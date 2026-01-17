import { App, PluginSettingTab, Setting } from 'obsidian';
import type TPSGlobalContextMenuPlugin from './main';

/**
 * Settings tab for the plugin
 */
export class TPSGlobalContextMenuSettingTab extends PluginSettingTab {
  plugin: TPSGlobalContextMenuPlugin;

  constructor(app: App, plugin: TPSGlobalContextMenuPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    const createSection = (title: string, open = false) => {
      const details = containerEl.createEl('details', { cls: 'tps-gcm-settings-group' });
      // Add basic styling inline if CSS is missing, or rely on plugin class
      details.style.border = '1px solid var(--background-modifier-border)';
      details.style.borderRadius = '6px';
      details.style.padding = '10px';
      details.style.marginBottom = '10px';
      if (open) details.setAttr('open', '');
      const summary = details.createEl('summary', { text: title });
      summary.style.fontWeight = 'bold';
      summary.style.cursor = 'pointer';
      summary.style.marginBottom = '10px';
      return details.createDiv({ cls: 'tps-gcm-settings-group-content' });
    };

    containerEl.createEl('h2', { text: 'TPS Global Context Menu' });

    containerEl.createEl('p', {
      text: 'Define a single context menu that can be reused throughout the vault. Menu items accept JSON definitions to keep the configuration portable and extendable.',
    });

    // --- General Settings ---
    const general = createSection('General Settings', true);

    new Setting(general)
      .setName('Enable console logging')
      .setDesc('Show debug logs in the developer console.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableLogging).onChange(async (value) => {
          this.plugin.settings.enableLogging = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(general)
      .setName('Enable in Live Preview & Editor')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableInLivePreview)
          .onChange(async (value) => {
            this.plugin.settings.enableInLivePreview = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(general)
      .setName('Enable in Reading View & Popovers')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableInPreview)
          .onChange(async (value) => {
            this.plugin.settings.enableInPreview = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(general)
      .setName('Enable in side panels')
      .setDesc(
        'Toggle whether the menu should appear in explorer panes, backlinks, canvases, etc.'
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableInSidePanels)
          .onChange(async (value) => {
            this.plugin.settings.enableInSidePanels = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(general)
      .setName('Strict Context Menu Mode')
      .setDesc('Completely replace the native context menu with this custom one. Prevents duplicates and gives full control.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableStrictMode)
          .onChange(async (value) => {
            this.plugin.settings.enableStrictMode = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(general)
      .setName('Enable line items')
      .setDesc('Show line-item specific actions (schedule, edit) in the context menu.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableLineItems)
          .onChange(async (value) => {
            this.plugin.settings.enableLineItems = value;
            await this.plugin.saveSettings();
          })
      );


    // --- View Mode Settings ---
    const viewMode = createSection('View Mode Settings', false);

    new Setting(viewMode)
      .setName('Enable View Mode Switching')
      .setDesc('Automatically switch between Source, Live Preview, and Reading modes based on frontmatter.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableViewModeSwitching)
          .onChange(async (value) => {
            this.plugin.settings.enableViewModeSwitching = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(viewMode)
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

    new Setting(viewMode)
      .setName('Ignored Folders')
      .setDesc('One path per line. Files in these folders will generally keep their current view mode (avoids conflicts with other plugins like Feed Bases).')
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

    new Setting(viewMode)
      .setName('View Mode Rules')
      .setDesc('Define specific statuses that should trigger specific view modes (fallback if no explicit view mode is set).')
      .addButton(btn => btn
        .setButtonText('Add Rule')
        .setCta()
        .onClick(async () => {
          if (!this.plugin.settings.viewModeRules) this.plugin.settings.viewModeRules = [];
          this.plugin.settings.viewModeRules.push({ key: 'status', value: '', mode: 'reading' });
          await this.plugin.saveSettings();
          this.display(); // Refresh to show new item
        }));

    // Render rules
    if (this.plugin.settings.viewModeRules) {
      this.plugin.settings.viewModeRules.forEach((rule, index) => {
        const div = viewMode.createDiv();
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '10px';
        div.style.marginBottom = '10px';
        div.style.paddingLeft = '20px'; // Indent slightly

        // Key Input
        new Setting(div)
          .setClass('tps-gcm-no-border')
          .addText(text => text
            .setPlaceholder('Key (e.g. status)')
            .setValue(rule.key)
            .onChange(async (value) => {
              rule.key = value;
              await this.plugin.saveSettings();
            }));

        div.createSpan({ text: '=' });

        // Value Input
        new Setting(div)
          .setClass('tps-gcm-no-border')
          .addText(text => text
            .setPlaceholder('Value (e.g. complete)')
            .setValue(rule.value)
            .onChange(async (value) => {
              rule.value = value;
              await this.plugin.saveSettings();
            }));

        // Arrow/Label
        div.createSpan({ text: '→' });

        // Mode Dropdown
        new Setting(div)
          .setClass('tps-gcm-no-border')
          .addDropdown(drop => drop
            .addOption('reading', 'Reading View')
            .addOption('source', 'Source Mode')
            .addOption('live', 'Live Preview')
            .setValue(rule.mode)
            .onChange(async (value) => {
              rule.mode = value;
              await this.plugin.saveSettings();
            }));

        // Delete Button
        new Setting(div)
          .setClass('tps-gcm-no-border')
          .addButton(btn => btn
            .setIcon('trash')
            .setTooltip('Delete Rule')
            .onClick(async () => {
              this.plugin.settings.viewModeRules.splice(index, 1);
              await this.plugin.saveSettings();
              this.display();
            }));
      });
    }

    // --- Checklist & Recurrence Settings ---
    const checklists = createSection('Checklist & Recurrence Settings', false);

    new Setting(checklists)
      .setName('Check for open checklist items')
      .setDesc('Prompt when marking a note as "complete" if there are unfinished checklist items.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.checkOpenChecklistItems)
          .onChange(async (value) => {
            this.plugin.settings.checkOpenChecklistItems = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(checklists)
      .setName('Enable Recurrence')
      .setDesc('Enable automatic creation of next recurrence when tasks are completed')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableRecurrence)
          .onChange(async (value) => {
            this.plugin.settings.enableRecurrence = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(checklists)
      .setName('Prompt on Recurrence Edit')
      .setDesc('Show a prompt when editing recurring tasks to choose whether to update all future instances')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.promptOnRecurrenceEdit)
          .onChange(async (value) => {
            this.plugin.settings.promptOnRecurrenceEdit = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(checklists)
      .setName('Completion statuses that create next recurrence')
      .setDesc('Comma-separated statuses that will spawn the next recurring instance before changing status (and then clear the recurrence on the current note).')
      .addText((text) =>
        text
          .setPlaceholder('complete, wont-do')
          .setValue((this.plugin.settings.recurrenceCompletionStatuses || []).join(', '))
          .onChange(async (value) => {
            this.plugin.settings.recurrenceCompletionStatuses = value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    new Setting(checklists)
      .setName('Recurrence Prompt Timeout')
      .setDesc('Minutes before prompting again for the same file (prevents repeated prompts)')
      .addSlider((slider) =>
        slider
          .setLimits(1, 30, 1)
          .setValue(this.plugin.settings.recurrencePromptTimeout)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.recurrencePromptTimeout = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(checklists)
      .setName('Default Status for New Recurrence')
      .setDesc('The status to set when creating a new recurrence instance (e.g., "open")')
      .addText((text) =>
        text
          .setPlaceholder('open')
          .setValue(this.plugin.settings.recurrenceDefaultStatus || 'open')
          .onChange(async (value) => {
            this.plugin.settings.recurrenceDefaultStatus = value || 'open';
            await this.plugin.saveSettings();
          })
      );

    // --- File Naming Settings ---
    const naming = createSection('File Naming Settings', false);

    new Setting(naming)
      .setName('Enable Auto-Rename')
      .setDesc('Automatically rename files based on title and scheduled date when opened')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAutoRename)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoRename = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(naming)
      .setName('Auto-Save Folder Path')
      .setDesc('Automatically save the current folder path to frontmatter when files are opened')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoSaveFolderPath)
          .onChange(async (value) => {
            this.plugin.settings.autoSaveFolderPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(naming)
      .setName('Folder Exclusions')
      .setDesc('One path per line. Files in these folders will be ignored by auto-rename and other automations.')
      .addTextArea((text) => {
        text
          .setPlaceholder('System/Templates\nArchive')
          .setValue(this.plugin.settings.folderExclusions || '')
          .onChange(async (value) => {
            this.plugin.settings.folderExclusions = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.cols = 30;
      });

    // --- System Commands ---
    const commands = createSection('System Commands', false);
    commands.createEl('p', { text: 'Select which system commands appear in the context menu.' });

    const systemCommands = [
      { id: 'open-in-new-tab', label: 'Open in New Tab', desc: 'Opens the file in a new tab' },
      { id: 'open-to-right', label: 'Open to the Right', desc: 'Opens the file in a new split to the right' }, // New
      { id: 'open-in-new-window', label: 'Open in New Window', desc: 'Opens the file in a new window' }, // New
      { id: 'open-in-same-tab', label: 'Open in Same Tab', desc: 'Opens the file in the current tab' },
      { id: 'rename', label: 'Rename', desc: 'Rename the file' }, // New
      { id: 'bookmark', label: 'Bookmark', desc: 'Toggle bookmark for file' }, // New (Obsidian 1.5+)
      { id: 'move-file', label: 'Move file to...', desc: 'Move the file to another folder' }, // New
      { id: 'duplicate', label: 'Duplicate File', desc: 'Creates a copy of the file' },
      { id: 'copy-url', label: 'Copy Obsidian URL', desc: 'Copy obsidian://open entry URL' }, // New
      { id: 'get-relative-path', label: 'Copy Relative Path', desc: 'Copies the file path to clipboard' },
      { id: 'reveal-finder', label: 'Reveal in System Explorer', desc: 'Show file in Finder/Explorer' }, // New
      { id: 'reveal-nav', label: 'Reveal in Navigation', desc: 'Show file in the sidebar file explorer' }, // New
    ];

    systemCommands.forEach(cmd => {
      new Setting(commands)
        .setName(cmd.label)
        .setDesc(cmd.desc)
        .addToggle(toggle => toggle
          .setValue((this.plugin.settings.systemCommands || []).includes(cmd.id))
          .onChange(async (value) => {
            let cmds = this.plugin.settings.systemCommands || [];
            if (value && !cmds.includes(cmd.id)) {
              cmds.push(cmd.id);
            } else if (!value) {
              cmds = cmds.filter(c => c !== cmd.id);
            }
            this.plugin.settings.systemCommands = cmds;
            await this.plugin.saveSettings();
          }));
    });

    // --- Menu Properties ---
    const props = createSection('Menu Properties', false);
    props.createEl('p', { text: 'Define which properties appear in the context menu.' });

    const propertiesContainer = props.createDiv();
    this.renderProperties(propertiesContainer);

    new Setting(props)
      .addButton(btn => btn
        .setButtonText('Add Property')
        .setCta()
        .onClick(() => {
          this.plugin.settings.properties.push({
            id: Date.now().toString(),
            label: 'New Property',
            key: 'new_prop',
            type: 'text'
          });
          this.plugin.saveSettings();
          this.renderProperties(propertiesContainer);
        }));

    // --- Snooze Settings ---
    const snooze = createSection('Snooze Settings', false);
    snooze.createEl('p', { text: 'Define the options available in the snooze modal.' });

    const snoozeContainer = snooze.createDiv();
    this.renderSnoozeOptions(snoozeContainer);

    new Setting(snooze)
      .addButton(btn => btn
        .setButtonText('Add Snooze Option')
        .setCta()
        .onClick(async () => {
          if (!this.plugin.settings.snoozeOptions) this.plugin.settings.snoozeOptions = [];
          this.plugin.settings.snoozeOptions.push({ label: '15 Mins', minutes: 15 });
          await this.plugin.saveSettings();
          this.renderSnoozeOptions(snoozeContainer);
        }));

    containerEl.createEl('p', {
      text: 'Note: enable "Strict Context Menu Mode" to remove the native menu items completely.',
      cls: 'setting-item-description'
    });
  }

  renderProperties(container: HTMLElement) {
    container.empty();

    // Ensure properties exists
    if (!this.plugin.settings.properties) {
      this.plugin.settings.properties = [];
    }

    this.plugin.settings.properties.forEach((prop, index) => {
      const div = container.createDiv('tps-gcm-setting-item');
      div.style.border = '1px solid var(--background-modifier-border)';
      div.style.padding = '10px';
      div.style.marginBottom = '10px';
      div.style.borderRadius = '6px';
      div.style.display = 'flex';
      div.style.flexDirection = 'column';
      div.style.gap = '10px';

      const header = div.createDiv();
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.createEl('strong', { text: prop.label || 'Unnamed Property' });

      const controls = header.createDiv();

      // Move Up
      if (index > 0) {
        const upBtn = controls.createEl('button', { text: '↑' });
        upBtn.onclick = async () => {
          const temp = this.plugin.settings.properties[index - 1];
          this.plugin.settings.properties[index - 1] = prop;
          this.plugin.settings.properties[index] = temp;
          await this.plugin.saveSettings();
          this.renderProperties(container);
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
          this.renderProperties(container);
        };
      }

      const delBtn = controls.createEl('button', { text: 'Delete' });
      delBtn.onclick = async () => {
        this.plugin.settings.properties.splice(index, 1);
        await this.plugin.saveSettings();
        this.renderProperties(container);
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
          .addOption('list', 'List (Tags)')
          .addOption('recurrence', 'Recurrence')
          .addOption('folder', 'Type (Folder)')
          .addOption('snooze', 'Snooze')
          .setValue(prop.type)
          .onChange(async (value: any) => {
            prop.type = value;
            await this.plugin.saveSettings();
            this.renderProperties(container); // Re-render to show/hide options
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

      // Show in Collapsed View
      new Setting(fields)
        .setName('Show in Collapsed View')
        .setDesc('Show this property in the inline header when collapsed')
        .addToggle(toggle => toggle
          .setValue(prop.showInCollapsed !== false)
          .onChange(async (value) => {
            prop.showInCollapsed = value;
            await this.plugin.saveSettings();
          }));

      // Show in Context Menu
      new Setting(fields)
        .setName('Show in Context Menu')
        .setDesc('Show this property in the right-click context menu')
        .addToggle(toggle => toggle
          .setValue(prop.showInContextMenu !== false)
          .onChange(async (value) => {
            prop.showInContextMenu = value;
            await this.plugin.saveSettings();
          }));

      // Options (only for selector)
      if (prop.type === 'selector') {
        const optionsDiv = div.createDiv();
        optionsDiv.style.gridColumn = '1 / -1';
        new Setting(optionsDiv)
          .setName('Options (comma separated)')
          .addTextArea(text => text
            .setValue((prop.options || []).join(', '))
            .onChange(async (value) => {
              prop.options = value.split(',').map(s => s.trim()).filter(s => s);
              await this.plugin.saveSettings();
            }));
      }
    });
  }
  renderSnoozeOptions(container: HTMLElement) {
    container.empty();
    if (!this.plugin.settings.snoozeOptions) {
      this.plugin.settings.snoozeOptions = [];
    }

    this.plugin.settings.snoozeOptions.forEach((opt, index) => {
      const div = container.createDiv();
      div.style.display = 'flex';
      div.style.alignItems = 'center';
      div.style.gap = '10px';
      div.style.marginBottom = '10px';

      new Setting(div)
        .setClass('tps-gcm-no-border')
        .addText(text => text
          .setPlaceholder('Label (e.g. 15m)')
          .setValue(opt.label)
          .onChange(async (value) => {
            opt.label = value;
            await this.plugin.saveSettings();
          }));

      new Setting(div)
        .setClass('tps-gcm-no-border')
        .addText(text => text
          .setPlaceholder('Minutes')
          .setValue(String(opt.minutes))
          .onChange(async (value) => {
            const val = parseInt(value);
            if (!isNaN(val)) {
              opt.minutes = val;
              await this.plugin.saveSettings();
            }
          }));

      new Setting(div)
        .setClass('tps-gcm-no-border')
        .addButton(btn => btn
          .setIcon('trash')
          .onClick(async () => {
            this.plugin.settings.snoozeOptions.splice(index, 1);
            await this.plugin.saveSettings();
            this.renderSnoozeOptions(container);
          }));
    });
  }
}
