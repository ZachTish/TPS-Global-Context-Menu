import {
  parseTPSHealthUiExactContext,
  parseTPSHealthUiHomeActionId,
  type TPSHealthUiApiSnapshot,
  type TPSHealthUiExactContext,
  type TPSHealthUiHomeActionId,
} from '../tps-health-ui-contract';

export type HealthUiHomeActionRouteResult =
  | { matched: false }
  | { matched: true; status: 'handled'; commandId: TPSHealthUiHomeActionId }
  | { matched: true; status: 'unavailable'; commandId: TPSHealthUiHomeActionId }
  | { matched: true; status: 'failed'; commandId: TPSHealthUiHomeActionId; error: unknown };

export function isHealthUiHomeActionId(value: unknown): value is TPSHealthUiHomeActionId {
  return parseTPSHealthUiHomeActionId(value) !== undefined;
}

export function canExecuteHealthUiHomeAction(
  api: Readonly<TPSHealthUiApiSnapshot> | undefined,
  commandId: unknown,
): boolean {
  const parsedCommandId = parseTPSHealthUiHomeActionId(commandId);
  if (!api || !parsedCommandId) return false;
  return api.supportedHomeActionIds.includes(parsedCommandId);
}

export async function routeHealthUiHomeAction(
  getApi: () => Readonly<TPSHealthUiApiSnapshot> | undefined,
  commandId: unknown,
  context: TPSHealthUiExactContext,
): Promise<HealthUiHomeActionRouteResult> {
  const parsedCommandId = parseTPSHealthUiHomeActionId(commandId);
  if (!parsedCommandId) return { matched: false };
  const parsedContext = parseTPSHealthUiExactContext(context);
  const api = getApi();
  if (!api
    || !parsedContext
    || !api.supportedHomeActionIds.includes(parsedCommandId)) {
    return { matched: true, status: 'unavailable', commandId: parsedCommandId };
  }
  try {
    const handled = await api.executeHomeAction(parsedCommandId, parsedContext);
    if (getApi()?.sourceApi !== api.sourceApi) {
      return { matched: true, status: 'unavailable', commandId: parsedCommandId };
    }
    return handled
      ? { matched: true, status: 'handled', commandId: parsedCommandId }
      : { matched: true, status: 'unavailable', commandId: parsedCommandId };
  } catch (error) {
    if (getApi()?.sourceApi !== api.sourceApi) {
      return { matched: true, status: 'unavailable', commandId: parsedCommandId };
    }
    return { matched: true, status: 'failed', commandId: parsedCommandId, error };
  }
}
