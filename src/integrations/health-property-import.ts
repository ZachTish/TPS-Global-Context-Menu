type HealthPropertyType = 'text' | 'number' | 'datetime' | 'selector' | 'list' | 'checkbox';

interface HealthPropertyScope {
  mode: 'any' | 'all';
  kinds?: string[];
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
  listItemType?: 'text' | 'link' | 'tag';
  scope: HealthPropertyScope;
}

export interface HealthPropertyCatalog {
  version: 1 | 2;
  food: HealthPropertyCatalogEntry[];
  dailyRollups: HealthPropertyCatalogEntry[];
  nativeRecords?: HealthPropertyCatalogEntry[];
}

export interface ImportedHealthProperty {
  id: string;
  label: string;
  key: string;
  type: HealthPropertyType;
  options?: string[];
  optionSources?: Array<'manual'>;
  optionsSource?: 'manual';
  listItemType?: 'text' | 'link' | 'tag';
  icon?: string;
  showInCollapsed: boolean;
  showInContextMenu: boolean;
  allowInlineSet: boolean;
  showWhen: 'always' | 'populated';
  inlineShowWhen: 'always' | 'populated';
  contextMenuShowWhen: 'always' | 'populated';
  scopeTags?: string[];
  scopeKinds?: string[];
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

function importedProperty(section: 'food' | 'rollup' | 'native', entry: HealthPropertyCatalogEntry): ImportedHealthProperty {
  const property: ImportedHealthProperty = {
    id: `${HEALTH_PROPERTY_IMPORT_ID_PREFIX}${section}-${entry.id}`,
    label: entry.label,
    key: entry.key,
    type: entry.type,
    icon: entry.icon,
    showInCollapsed: true,
    showInContextMenu: true,
    allowInlineSet: false,
    showWhen: section === 'native' ? 'always' : 'populated',
    inlineShowWhen: section === 'native' ? 'always' : 'populated',
    contextMenuShowWhen: section === 'native' ? 'always' : 'populated',
    scopeTags: entry.scope.tags ? [...entry.scope.tags] : undefined,
    scopeKinds: entry.scope.kinds ? [...entry.scope.kinds] : undefined,
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

function unionStrings(...groups: Array<string[] | undefined>): string[] | undefined {
  const values = Array.from(new Set(groups.flatMap((group) => group || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)));
  return values.length > 0 ? values : undefined;
}

function unionConditions(
  ...groups: Array<ImportedHealthProperty['scopeProperties'] | undefined>
): ImportedHealthProperty['scopeProperties'] {
  const bySignature = new Map<string, NonNullable<ImportedHealthProperty['scopeProperties']>[number]>();
  for (const condition of groups.flatMap((group) => group || [])) {
    const signature = `${condition.key.trim().toLocaleLowerCase()}\u0000${condition.operator}\u0000${condition.value.trim().toLocaleLowerCase()}`;
    if (!bySignature.has(signature)) bySignature.set(signature, { ...condition });
  }
  return bySignature.size > 0 ? [...bySignature.values()] : undefined;
}

function mergeDesiredProperties(properties: ImportedHealthProperty[]): ImportedHealthProperty[] {
  const byKey = new Map<string, ImportedHealthProperty>();
  for (const property of properties) {
    const key = normalizedKey(property.key);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, property);
      continue;
    }
    byKey.set(key, {
      ...existing,
      options: unionStrings(existing.options, property.options),
      scopeTags: unionStrings(existing.scopeTags, property.scopeTags),
      scopeKinds: unionStrings(existing.scopeKinds, property.scopeKinds),
      scopePaths: unionStrings(existing.scopePaths, property.scopePaths),
      scopeProperties: unionConditions(existing.scopeProperties, property.scopeProperties),
      scopeMode: 'any',
      showWhen: existing.showWhen === 'always' || property.showWhen === 'always' ? 'always' : 'populated',
      inlineShowWhen: existing.inlineShowWhen === 'always' || property.inlineShowWhen === 'always' ? 'always' : 'populated',
      contextMenuShowWhen: existing.contextMenuShowWhen === 'always' || property.contextMenuShowWhen === 'always' ? 'always' : 'populated',
    });
  }
  return [...byKey.values()];
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
  if (!catalog || ![1, 2].includes(catalog.version) || !Array.isArray(catalog.food) || !Array.isArray(catalog.dailyRollups)) {
    throw new Error('TPS Health returned an unsupported property catalog.');
  }

  const desired = mergeDesiredProperties([
    ...catalog.food.map((entry) => importedProperty('food', entry)),
    ...catalog.dailyRollups.map((entry) => importedProperty('rollup', entry)),
    ...(catalog.nativeRecords || []).map((entry) => importedProperty('native', entry)),
  ]);
  const desiredKeys = new Set(desired.map((property) => normalizedKey(property.key)));
  const oldImported = existingProperties.filter((property) => importedId(property.id));
  const existingByKey = new Map(existingProperties.map((property) => [normalizedKey(property.key), property]));
  const mergedDesired = desired.map((property) => {
    const existing = existingByKey.get(normalizedKey(property.key)) as (T & Partial<ImportedHealthProperty>) | undefined;
    if (!existing || importedId(existing.id)) return property;
    return {
      ...property,
      ...existing,
      type: property.type,
      options: unionStrings(property.options, existing.options),
      scopeTags: unionStrings(property.scopeTags, existing.scopeTags),
      scopeKinds: unionStrings(property.scopeKinds, existing.scopeKinds),
      scopePaths: unionStrings(property.scopePaths, existing.scopePaths),
      scopeProperties: unionConditions(property.scopeProperties, existing.scopeProperties),
      scopeMode: property.scopeMode === 'any' || existing.scopeMode === 'any' ? 'any' : 'all',
    } as T | ImportedHealthProperty;
  });
  const retained = existingProperties.filter((property) => (
    !importedId(property.id) && !desiredKeys.has(normalizedKey(property.key))
  ));
  const added = desired.filter((property) => !existingByKey.has(normalizedKey(property.key))).length;
  const updated = desired.length - added;
  const desiredIds = new Set(desired.map((property) => property.id));
  const removed = oldImported.filter((property) => !desiredIds.has(String(property.id || ''))).length;

  return {
    properties: [...retained, ...mergedDesired],
    added,
    updated,
    removed,
  };
}
