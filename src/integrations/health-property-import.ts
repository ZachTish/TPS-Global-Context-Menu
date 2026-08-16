type HealthPropertyType = 'text' | 'number' | 'datetime' | 'selector' | 'list';

interface HealthPropertyScope {
  mode: 'any' | 'all';
  tags?: string[];
  paths?: string[];
  properties?: Array<{
    key: string;
    value: string;
    operator: 'equals' | 'exists';
  }>;
}

interface HealthPropertyCatalogEntry {
  id: string;
  key: string;
  label: string;
  type: HealthPropertyType;
  icon?: string;
  options?: string[];
  listItemType?: 'text';
  scope: HealthPropertyScope;
}

export interface HealthPropertyCatalog {
  version: 1;
  food: HealthPropertyCatalogEntry[];
  dailyRollups: HealthPropertyCatalogEntry[];
}

export interface ImportedHealthProperty {
  id: string;
  label: string;
  key: string;
  type: HealthPropertyType;
  options?: string[];
  optionSources?: Array<'manual'>;
  optionsSource?: 'manual';
  listItemType?: 'text';
  icon?: string;
  showInCollapsed: boolean;
  showInContextMenu: boolean;
  allowInlineSet: boolean;
  showWhen: 'populated';
  inlineShowWhen: 'populated';
  contextMenuShowWhen: 'populated';
  scopeTags?: string[];
  scopePaths?: string[];
  scopeProperties?: Array<{
    key: string;
    value: string;
    operator: 'equals' | 'exists';
  }>;
  scopeMode: 'any' | 'all';
}

export interface HealthPropertyImportResult<T> {
  properties: T[];
  added: number;
  updated: number;
  removed: number;
}

export const HEALTH_PROPERTY_IMPORT_ID_PREFIX = 'health-import-';

function importedProperty(section: 'food' | 'rollup', entry: HealthPropertyCatalogEntry): ImportedHealthProperty {
  const property: ImportedHealthProperty = {
    id: `${HEALTH_PROPERTY_IMPORT_ID_PREFIX}${section}-${entry.id}`,
    label: entry.label,
    key: entry.key,
    type: entry.type,
    icon: entry.icon,
    showInCollapsed: true,
    showInContextMenu: true,
    allowInlineSet: false,
    showWhen: 'populated',
    inlineShowWhen: 'populated',
    contextMenuShowWhen: 'populated',
    scopeTags: entry.scope.tags ? [...entry.scope.tags] : undefined,
    scopePaths: entry.scope.paths ? [...entry.scope.paths] : undefined,
    scopeProperties: entry.scope.properties?.map((condition) => ({ ...condition })),
    scopeMode: entry.scope.mode,
  };
  if (entry.options?.length) {
    property.options = [...entry.options];
    property.optionSources = ['manual'];
    property.optionsSource = 'manual';
  }
  if (entry.listItemType) property.listItemType = entry.listItemType;
  return property;
}

function normalizedKey(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function importedId(value: unknown): boolean {
  return String(value || '').trim().toLowerCase().startsWith(HEALTH_PROPERTY_IMPORT_ID_PREFIX);
}

export function importHealthPropertyCatalog<T extends { id?: string; key?: string }>(
  existingProperties: T[],
  catalog: HealthPropertyCatalog,
): HealthPropertyImportResult<T | ImportedHealthProperty> {
  if (!catalog || catalog.version !== 1 || !Array.isArray(catalog.food) || !Array.isArray(catalog.dailyRollups)) {
    throw new Error('TPS Health returned an unsupported property catalog.');
  }

  const desired = [
    ...catalog.food.map((entry) => importedProperty('food', entry)),
    ...catalog.dailyRollups.map((entry) => importedProperty('rollup', entry)),
  ];
  const desiredKeys = new Set(desired.map((property) => normalizedKey(property.key)));
  const oldImported = existingProperties.filter((property) => importedId(property.id));
  const retained = existingProperties.filter((property) => (
    !importedId(property.id) && !desiredKeys.has(normalizedKey(property.key))
  ));
  const existingByKey = new Map(existingProperties.map((property) => [normalizedKey(property.key), property]));
  const added = desired.filter((property) => !existingByKey.has(normalizedKey(property.key))).length;
  const updated = desired.length - added;
  const desiredIds = new Set(desired.map((property) => property.id));
  const removed = oldImported.filter((property) => !desiredIds.has(String(property.id || ''))).length;

  return {
    properties: [...retained, ...desired],
    added,
    updated,
    removed,
  };
}
