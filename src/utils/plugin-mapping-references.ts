import type { PropertyMigration, SettingsPatch } from './property-migration';
import { settingsPatches } from './property-migration';

export const PLUGIN_MAPPING_FIELDS: Record<string, Record<string, string>> = {
  'tps-controller': { titleKey: 'title', statusKey: 'status', previousStatusKey: 'tpsCalendarPrevStatus', startProperty: 'scheduled', endProperty: 'timeEstimate' },
  'tps-calendar-base': { titleKey: 'title', statusKey: 'status', previousStatusKey: 'tpsCalendarPrevStatus', frontmatterColorField: 'color', frontmatterIconField: 'icon' },
  'tps-health': { foodFrontmatterKey: 'kind', workoutFrontmatterKey: 'kind', workoutStartPropertyKey: 'scheduled', workoutIntervalPropertyKey: 'timeEstimate' },
};
export type PluginSettingsPatch = { pluginId: string; patches: SettingsPatch[] };
export function pluginMappingPatches(pluginId: string, settings: any, change: PropertyMigration): SettingsPatch[] {
  if (change.kind !== 'key') return [];
  const next = JSON.parse(JSON.stringify(settings));
  const matches = (key: unknown) => typeof key === 'string' && key.toLowerCase() === change.from.toLowerCase();
  const mapped = PLUGIN_MAPPING_FIELDS[pluginId] || {};
  if (Object.entries(mapped).some(([field, fallback]) => !matches(settings[field] || fallback) && String(settings[field] || fallback).toLowerCase() === change.to.toLowerCase())) throw new Error(`${pluginId} already uses that key for another mapping.`);
  for (const [field, fallback] of Object.entries(PLUGIN_MAPPING_FIELDS[pluginId] || {})) if (matches(settings[field] || fallback)) next[field] = change.to;
  if (pluginId === 'tps-health') {
    if (Object.values(next.nativeRecordProperties || {}).some(key => !matches(key) && String(key).toLowerCase() === change.to.toLowerCase())) throw new Error('TPS Health already uses that key for another record property.');
    for (const [field, key] of Object.entries(next.nativeRecordProperties || {})) if (matches(key)) next.nativeRecordProperties[field] = change.to;
  }
  return settingsPatches(settings, next);
}
