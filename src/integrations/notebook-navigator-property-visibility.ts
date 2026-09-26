import { App, Notice, Setting, ToggleComponent } from 'obsidian';

type Surface = 'showInNavigation' | 'showInList' | 'showInFileMenu';
interface Visibility extends Record<Surface, boolean> { profileId: string; profileName: string }
interface VisibilityAPI {
  version: number;
  get(key: string): Visibility;
  set(key: string, surface: Surface, visible: boolean, profileId: string): Promise<Visibility>;
}

export function navigatorPropertyVisibility(app: App): VisibilityAPI | null {
  const api = (app as any).plugins?.plugins?.['tps-notebook-navigator']?.api?.propertyVisibility;
  return api?.version === 1 && typeof api.get === 'function' && typeof api.set === 'function' ? api : null;
}

/** Present the owner's current settings, never a second persisted copy. */
export function renderNavigatorPropertyVisibility(parent: HTMLElement, app: App, getKey: () => string): void {
  const api = navigatorPropertyVisibility(app);
  if (!api) {
    new Setting(parent).setName('Notebook Navigator visibility')
      .setDesc('Enable TPS Notebook Navigator 6.5.0 or newer to configure navigation, note-list and file-menu visibility here.');
    return;
  }
  let state = api.get(getKey());
  const controls: Array<{ surface: Surface; toggle: ToggleComponent }> = [];
  const surfaces: Array<[Surface, string, string]> = [
    ['showInNavigation', 'Show in Navigator navigation', 'Include this property in the Properties tree.'],
    ['showInList', 'Show in Navigator note list', 'Display populated values on note rows when list properties are enabled.'],
    ['showInFileMenu', 'Show in Navigator file menu', 'Include this property in Navigator’s file context menu.'],
  ];
  for (const [surface, label, description] of surfaces) {
    new Setting(parent).setName(label).setDesc(`${description} Profile: ${state.profileName}.`)
      .addToggle(toggle => {
        controls.push({ surface, toggle });
        toggle.setValue(state[surface]).onChange(async visible => {
          controls.forEach(control => control.toggle.setDisabled(true));
          try {
            state = await api.set(getKey(), surface, visible, state.profileId);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : 'Could not save Navigator property visibility.');
          } finally {
            controls.forEach(control => control.toggle.setValue(state[control.surface]).setDisabled(false));
          }
        });
      });
  }
}
