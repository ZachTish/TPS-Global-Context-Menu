import type { App, TFile } from 'obsidian';
import type { CustomProperty } from '../types';

export interface LinkedChoice { value: string; label: string; aliases?: string[] }
export interface LinkedChoiceProvider {
  label: string;
  sourceProperties: string[];
  getChoices(frontmatter: Record<string, unknown>): LinkedChoice[];
}
export interface LinkedChoiceState {
  choices: LinkedChoice[];
  message: string;
  source?: TFile;
  fingerprint: string;
}
export const usesLinkedOptions = (property: Partial<CustomProperty> | null | undefined): boolean => property?.optionSources?.includes('linked') === true;
const valueAt = (fm: Record<string, unknown>, key: string): unknown => fm[key] ?? fm[Object.keys(fm).find(k => k.toLowerCase() === key.toLowerCase()) || ''];

export function linkedChoiceProviders(app: App): Array<{id: string; provider: LinkedChoiceProvider}> {
  const result: Array<{id: string; provider: LinkedChoiceProvider}> = [];
  for (const [id, plugin] of Object.entries((app as any).plugins?.plugins || {}) as Array<[string, any]>) {
    const api = plugin?.api?.linkedPropertyChoices;
    if (api?.version !== 1) continue;
    for (const [name, provider] of Object.entries(api.providers || {}) as Array<[string, LinkedChoiceProvider]>) {
      if (Array.isArray(provider?.sourceProperties) && typeof provider.getChoices === 'function') result.push({id: `${id}:${name}`, provider});
    }
  }
  return result;
}

function providerFor(app: App, id: string): LinkedChoiceProvider | undefined {
  const split = id.indexOf(':');
  const api = (app as any).plugins?.plugins?.[id.slice(0, split)]?.api?.linkedPropertyChoices;
  return api?.version === 1 ? api.providers?.[id.slice(split + 1)] : undefined;
}

/** Constant-time indexed link resolution. Never asks the entity/catalog index to bootstrap. */
export function linkedChoiceInput(app: App, property: CustomProperty, file: TFile, targetFrontmatter?: Record<string, unknown>, sourceFrontmatter?: Record<string, unknown>) {
  const config = property.linkedOptions;
  const cache = targetFrontmatter ?? app.metadataCache.getFileCache(file)?.frontmatter;
  let message = '';
  let source: TFile | undefined;
  if (!config?.linkProperty) message = 'Choose the link property in GCM settings.';
  else if (!cache) message = 'Waiting for note properties…';
  else {
    let link = valueAt(cache, config.linkProperty);
    if (Array.isArray(link)) link = link.length === 1 ? link[0] : undefined;
    if (typeof link !== 'string' || !link.trim()) message = `Choose one ${config.linkProperty} note first.`;
    else {
      const wiki = /^\[\[([^\]]+)\]\]$/.exec(link.trim());
      const target = (wiki ? wiki[1].split('|')[0] : link.trim());
      if (target.includes('#')) message = 'Choose a whole note, not a heading or block.';
      else source = app.metadataCache.getFirstLinkpathDest(target, file.path) ?? undefined;
      if (!source && !message) message = 'The linked note could not be found.';
    }
  }
  const provider = config?.provider ? providerFor(app, config.provider) : undefined;
  const fields = config?.provider ? provider?.sourceProperties || [] : [config?.sourceProperty || ''];
  const fm = sourceFrontmatter ?? (source ? app.metadataCache.getFileCache(source)?.frontmatter : undefined);
  if (source && !fm) message = 'Waiting for linked note properties…';
  else if (source && config?.provider && !provider) message = 'Enable or update the plugin that supplies these choices.';
  else if (source && !config?.provider && !config?.sourceProperty) message = 'Choose the source property in GCM settings.';
  const projection = Object.fromEntries(fields.map(key => [key, fm ? valueAt(fm, key) : undefined]));
  const fingerprint = JSON.stringify([file.path, config, cache ? valueAt(cache, property.key) : undefined, source?.path, message, projection]);
  return {source, message, projection, provider, fingerprint};
}

export function readLinkedChoices(app: App, property: CustomProperty, file: TFile, targetFrontmatter?: Record<string, unknown>, sourceFrontmatter?: Record<string, unknown>): LinkedChoiceState {
  const input = linkedChoiceInput(app, property, file, targetFrontmatter, sourceFrontmatter);
  if (input.message) return {...input, choices: []};
  let choices: LinkedChoice[] = [];
  try {
    if (input.provider) choices = input.provider.getChoices(input.projection);
    else {
      const value = input.projection[property.linkedOptions?.sourceProperty || ''];
      choices = (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => ({value: v.trim(), label: v.trim()}));
    }
    const unique = new Map<string, LinkedChoice>();
    for (const choice of choices) {
      if (typeof choice?.value !== 'string' || !choice.value.trim() || typeof choice.label !== 'string') continue;
      if (!unique.has(choice.value)) unique.set(choice.value, choice);
    }
    choices = [...unique.values()];
  } catch { return {...input, choices: [], message: 'Choices could not be read. Open the linked note to check its properties.'}; }
  return {...input, choices, message: choices.length ? '' : 'No choices are defined. Open the linked note to add them.'};
}

export const linkedChoiceMatches = (choice: LinkedChoice, value: unknown): boolean => [choice.value, ...(choice.aliases || [])].some(v => v.trim().toLowerCase() === String(value ?? '').trim().toLowerCase());
