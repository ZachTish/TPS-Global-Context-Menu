import type {
  HomeActionContext,
  HomeActionProvider,
  HomeComponentAction,
  HomeComponentActionMap,
} from '../types';

export type HomeActionHandler = (
  context: HomeActionContext,
) => void | boolean | Promise<void | boolean>;

export interface HomeActionRouteDependencies {
  getRegisteredHandler(commandId: string): HomeActionHandler | null;
  getProviders(): HomeActionProvider[];
  executeWorkspaceCommand(commandId: string): Promise<boolean>;
}

export type HomeActionRouteResult =
  | { status: 'handled'; route: 'registered' | 'provider' | 'workspace' }
  | { status: 'unavailable' };

export function normalizeHomeComponentActions(value: unknown): HomeComponentActionMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const normalized: HomeComponentActionMap = {};
  for (const [rawKey, rawActions] of Object.entries(value as Record<string, unknown>)) {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!key || !Array.isArray(rawActions)) continue;
    const seenIds = new Set<string>();
    const actions: HomeComponentAction[] = [];
    for (const [index, rawAction] of rawActions.entries()) {
      if (!rawAction || typeof rawAction !== 'object' || Array.isArray(rawAction)) continue;
      const source = rawAction as Record<string, unknown>;
      const commandId = String(source.commandId || '').trim();
      if (!commandId) continue;
      const label = String(source.label || '').trim();
      const icon = String(source.icon || '').trim();
      const baseId = String(source.id || '').trim() || `action-${index + 1}-${slugifyActionId(commandId)}`;
      let id = baseId;
      let suffix = 2;
      while (seenIds.has(id.toLowerCase())) id = `${baseId}-${suffix++}`;
      seenIds.add(id.toLowerCase());
      actions.push({
        id,
        commandId,
        ...(label ? { label } : {}),
        ...(icon ? { icon } : {}),
        target: source.target === 'workspace' ? 'workspace' : 'home-note',
      });
    }
    if (actions.length > 0) normalized[key] = actions;
  }
  return normalized;
}

export async function routeHomeComponentAction(
  action: HomeComponentAction,
  context: HomeActionContext,
  dependencies: HomeActionRouteDependencies,
): Promise<HomeActionRouteResult> {
  const commandId = String(action.commandId || '').trim();
  if (!commandId) return { status: 'unavailable' };

  if (action.target === 'workspace') {
    const handled = await dependencies.executeWorkspaceCommand(commandId);
    return handled ? { status: 'handled', route: 'workspace' } : { status: 'unavailable' };
  }

  if (!isValidHomeActionContext(context)) return { status: 'unavailable' };
  const registered = dependencies.getRegisteredHandler(commandId);
  if (registered) {
    await registered(context);
    return { status: 'handled', route: 'registered' };
  }

  for (const provider of dependencies.getProviders()) {
    if (!provider.canHandle(commandId)) continue;
    const handled = await provider.execute(commandId, context);
    if (handled !== false) return { status: 'handled', route: 'provider' };
  }
  return { status: 'unavailable' };
}

function isValidHomeActionContext(context: HomeActionContext): boolean {
  return context?.source === 'tps-home'
    && isValidIsoDate(String(context.dateIso || ''))
    && Boolean(String(context.dailyNotePath || '').trim())
    && Boolean(String(context.componentId || '').trim());
}

function isValidIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function slugifyActionId(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'command';
}
