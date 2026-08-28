export const TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID = 'tps-notebook-navigator';
export const UPSTREAM_NOTEBOOK_NAVIGATOR_PLUGIN_ID = 'notebook-navigator';

export type NotebookNavigatorPluginId =
  | typeof TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID
  | typeof UPSTREAM_NOTEBOOK_NAVIGATOR_PLUGIN_ID;

export interface NotebookNavigatorTagNavigationFailure {
  pluginId: NotebookNavigatorPluginId;
  phase: 'navigate' | 'clear-search';
  reason: 'missing' | 'returned-false' | 'rejected';
  error?: unknown;
}

type PluginManagerLike = {
  getPlugin?: (pluginId: string) => unknown;
  plugins?: Record<string, unknown>;
};

type AppWithPlugins = {
  plugins?: PluginManagerLike;
};

function resolvePlugin(
  pluginManager: PluginManagerLike | undefined,
  pluginId: NotebookNavigatorPluginId,
): any {
  if (!pluginManager) return null;
  try {
    const plugin = pluginManager.getPlugin?.(pluginId);
    if (plugin) return plugin;
  } catch {
    // Fall through to the public registry snapshot when lookup is unavailable.
  }
  return pluginManager.plugins?.[pluginId] ?? null;
}

function reportFailure(
  onFailure: ((failure: NotebookNavigatorTagNavigationFailure) => void) | undefined,
  failure: NotebookNavigatorTagNavigationFailure,
): void {
  try {
    onFailure?.(failure);
  } catch {
    // Diagnostics must never block the compatibility fallback chain.
  }
}

/**
 * Routes a tag to the co-installable TPS fork when it is ready, while retaining
 * compatibility with upstream Notebook Navigator as the fail-open fallback.
 */
export async function navigateTagWithNotebookNavigator(
  app: AppWithPlugins,
  tag: string,
  onFailure?: (failure: NotebookNavigatorTagNavigationFailure) => void,
): Promise<NotebookNavigatorPluginId | null> {
  const pluginManager = app?.plugins;
  const pluginIds: readonly NotebookNavigatorPluginId[] = [
    TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
    UPSTREAM_NOTEBOOK_NAVIGATOR_PLUGIN_ID,
  ];

  for (const pluginId of pluginIds) {
    const plugin = resolvePlugin(pluginManager, pluginId);
    const navigation = plugin?.api?.navigation;
    const navigateToTag = navigation?.navigateToTag;
    if (typeof navigateToTag !== 'function') continue;

    try {
      const didNavigate = await navigateToTag.call(navigation, tag);
      if (didNavigate !== true) {
        reportFailure(onFailure, {
          pluginId,
          phase: 'navigate',
          reason: 'returned-false',
        });
        continue;
      }
    } catch (error) {
      reportFailure(onFailure, {
        pluginId,
        phase: 'navigate',
        reason: 'rejected',
        error,
      });
      continue;
    }

    if (pluginId === TPS_NOTEBOOK_NAVIGATOR_PLUGIN_ID) {
      const list = plugin?.api?.list;
      const setSearch = list?.setSearch;
      if (typeof setSearch !== 'function') {
        reportFailure(onFailure, {
          pluginId,
          phase: 'clear-search',
          reason: 'missing',
        });
      } else {
        try {
          const didClearSearch = await setSearch.call(list, null);
          if (didClearSearch === false) {
            reportFailure(onFailure, {
              pluginId,
              phase: 'clear-search',
              reason: 'returned-false',
            });
          }
        } catch (error) {
          reportFailure(onFailure, {
            pluginId,
            phase: 'clear-search',
            reason: 'rejected',
            error,
          });
        }
      }
    }

    return pluginId;
  }

  return null;
}
