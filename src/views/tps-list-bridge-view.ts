import { BasesView, QueryController, type ViewOption } from 'obsidian';
import TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import { TpsListView, type TpsListHost } from '../tps-list/views/TpsListView';
import { DEFAULT_SETTINGS } from '../tps-list/settings';
import { getCurrentBaseEmbedRenderContext, takePendingBaseEmbedRenderContext } from './base-embed-context';

export const TPS_LIST_VIEW_TYPE = 'tps-list';

export function createTpsListViewOptions(createButtonOptions: ViewOption): ViewOption[] {
  return [
    {
      type: 'group',
      displayName: 'Grouping',
      items: [
        {
          key: 'groupBy',
          type: 'property',
          displayName: 'Group by',
          default: '',
          placeholder: 'No grouping',
        },
        {
          key: 'groupDirection',
          type: 'dropdown',
          displayName: 'Group order',
          default: 'asc',
          options: {
            asc: 'Ascending',
            desc: 'Descending',
          },
          shouldHide: (config) => !String(config.get('groupBy') || '').trim(),
        },
        {
          key: 'ungroupedPosition',
          type: 'dropdown',
          displayName: 'Items without a group',
          default: 'last',
          options: {
            first: 'Top',
            last: 'Bottom',
          },
        },
        {
          key: 'multiValueGrouping',
          type: 'dropdown',
          displayName: 'Items with multiple values',
          default: 'separate',
          options: {
            separate: 'Show in every matching group',
            combined: 'Show in one combined group',
          },
        },
      ],
    },
    createButtonOptions,
  ];
}

export function createTpsListView(controller: QueryController, containerEl: HTMLElement, plugin: TPSGlobalContextMenuPlugin): BasesView {
  inheritBaseEmbedContext(containerEl);
  containerEl.addEventListener('click', (event: MouseEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const link = target?.closest<HTMLElement>('a.internal-link');
    if (!link || !link.closest('.tps-list-native-row--note, .tps-list-native-property--source')) return;
    const path = link.dataset.href || link.dataset.linkpath || link.getAttribute('href') || '';
    const file = plugin.app.vault.getFileByPath(path);
    if (!file || file.extension.toLowerCase() !== 'md') return;
    plugin.openBaseNotePreviewFromClick(event, file, link, true);
  }, { capture: true });
  return new TpsListView(controller, containerEl, createTpsListPluginShim(plugin));
}

function inheritBaseEmbedContext(containerEl: HTMLElement): void {
  const renderContext = getCurrentBaseEmbedRenderContext() || takePendingBaseEmbedRenderContext(TPS_LIST_VIEW_TYPE);
  if (renderContext) {
    containerEl.dataset.tpsBasePath = renderContext.path;
    containerEl.dataset.tpsBaseDefinition = renderContext.definition;
    if (renderContext.sourcePath) containerEl.dataset.tpsContextPath = renderContext.sourcePath;
    return;
  }
  const host = containerEl.closest<HTMLElement>('[data-tps-base-path], [data-tps-base-definition]');
  if (!host) return;
  if (host.dataset.tpsBasePath) containerEl.dataset.tpsBasePath = host.dataset.tpsBasePath;
  if (host.dataset.tpsBaseDefinition) containerEl.dataset.tpsBaseDefinition = host.dataset.tpsBaseDefinition;
  if (host.dataset.tpsContextPath) containerEl.dataset.tpsContextPath = host.dataset.tpsContextPath;
}

export function createTpsListPluginShim(plugin: TPSGlobalContextMenuPlugin): TpsListHost {
  logger.flow('TpsListBridgeView', 'using-local-renderer', { owner: 'gcm' });
  return {
    app: plugin.app,
    gcmPlugin: plugin,
    openBaseNotePreviewFromClick: (event: MouseEvent, file: any, anchorEl: HTMLElement) =>
      plugin.openBaseNotePreviewFromClick(event, file, anchorEl, true),
    listSettings: DEFAULT_SETTINGS,
    saveSettings: async () => {},
  };
}
