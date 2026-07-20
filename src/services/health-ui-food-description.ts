import type {
  TPSHealthUiApiSnapshot,
  TPSHealthUiFoodDescriptionRequest,
} from '../tps-health-ui-contract';

export type HealthUiFoodDescriptionPreparation =
  | { status: 'prepared' }
  | { status: 'unavailable' }
  | { status: 'failed'; error: unknown };

export async function prepareCurrentHealthUiFoodDescription(
  getApi: () => Readonly<TPSHealthUiApiSnapshot> | undefined,
  request: TPSHealthUiFoodDescriptionRequest,
): Promise<HealthUiFoodDescriptionPreparation> {
  const api = getApi();
  if (!api) return { status: 'unavailable' };
  try {
    const result = await api.prepareFoodDescription(request);
    if (result.status !== 'prepared') return { status: 'failed', error: new Error('TPS Health did not prepare Describe.') };
    if (getApi()?.sourceApi !== api.sourceApi) return { status: 'unavailable' };
    return { status: 'prepared' };
  } catch (error) {
    if (getApi()?.sourceApi !== api.sourceApi) return { status: 'unavailable' };
    return { status: 'failed', error };
  }
}
