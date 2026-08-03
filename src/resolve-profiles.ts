import { CustomProperty } from './types';
import { ViewModeService } from './services/view-mode-service';
import { normalizeTagValue } from './utils/tag-utils';
import {
    getCustomPropertySurfaceVisibilityMode,
    type CustomPropertySurface,
    type CustomPropertyVisibilityMode,
} from './services/custom-property-visibility';

export type { CustomPropertySurface } from './services/custom-property-visibility';

export function resolveCustomProperties(
    properties: CustomProperty[],
    entries: any[],
    viewModeService: ViewModeService,
    surface: CustomPropertySurface = 'any',
): (CustomProperty & { disabled?: boolean; hidden?: boolean })[] {
    void viewModeService;
    const entryContexts = (entries || []).map((entry) => ({
        entry,
        tags: collectEntryTags(entry),
        path: normalizePathValue(entry?.file?.path || ''),
        frontmatter: entry?.frontmatter || {},
    }));
    return properties.filter((property) => {
        if (property.hidden) return false;
        if (entryContexts.length === 0) return true;

        const excluded = normalizeScopeTags(property.excludeTags || []);
        if (excluded.length > 0 && entryContexts.some((context) => excluded.some((tag) => context.tags.has(tag)))) {
            return false;
        }

        const excludedPaths = normalizeScopeList(property.excludePaths || []);
        if (excludedPaths.length > 0 && entryContexts.some((context) => matchesAnyPathScope(context.path, excludedPaths))) {
            return false;
        }

        const required = normalizeScopeTags(property.scopeTags || []);
        const requiredPaths = normalizeScopeList(property.scopePaths || []);
        const requiredProperties = normalizePropertyConditions(property.scopeProperties || []);
        const mode = property.scopeMode === 'all' ? 'all' : 'any';
        const scopeMatches = required.length === 0 && requiredPaths.length === 0 && requiredProperties.length === 0
            ? true
            : entryContexts.every((context) => {
                const checks: boolean[] = [];
                if (required.length > 0) {
                    checks.push(mode === 'all'
                        ? required.every((tag) => context.tags.has(tag))
                        : required.some((tag) => context.tags.has(tag)));
                }
                if (requiredPaths.length > 0) {
                    checks.push(matchesAnyPathScope(context.path, requiredPaths));
                }
                if (requiredProperties.length > 0) {
                    checks.push(requiredProperties.every((condition) => matchesPropertyCondition(context.frontmatter, condition)));
                }
                if (checks.length === 0) return true;
                return mode === 'all' ? checks.every(Boolean) : checks.some(Boolean);
            });
        if (!scopeMatches) return false;

        return matchesVisibilityMode(
            property,
            entryContexts,
            getCustomPropertySurfaceVisibilityMode(property, surface),
        );
    });
}

function matchesVisibilityMode(
    property: CustomProperty,
    entryContexts: Array<{ frontmatter: Record<string, unknown> }>,
    mode: CustomPropertyVisibilityMode,
): boolean {
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    const key = String(property.key || '').trim();
    if (!key) return false;

    if (mode === 'populated') {
        return entryContexts.some((context) => hasPopulatedValue(context.frontmatter, key));
    }
    if (mode === 'exists') {
        return entryContexts.some((context) => hasFrontmatterKey(context.frontmatter, key));
    }
    if (mode === 'blank') {
        return entryContexts.some((context) => hasFrontmatterKey(context.frontmatter, key) && !hasPopulatedValue(context.frontmatter, key));
    }
    if (mode === 'missing') {
        return entryContexts.some((context) => !hasFrontmatterKey(context.frontmatter, key));
    }
    if (mode === 'empty') {
        return entryContexts.some((context) => !hasPopulatedValue(context.frontmatter, key));
    }
    return true;
}

function normalizeScopeTags(tags: unknown): string[] {
    const raw = Array.isArray(tags) ? tags : String(tags || '').split(/[,\n]/);
    return Array.from(new Set(
        raw
            .map((tag) => normalizeTagValue(String(tag || '').trim()))
            .filter(Boolean),
    ));
}

function collectEntryTags(entry: any): Set<string> {
    const tags = new Set<string>();
    const add = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach(add);
            return;
        }
        const normalized = normalizeTagValue(String(value || '').trim());
        if (normalized) tags.add(normalized);
    };

    add(entry?.frontmatter?.tags);
    add(entry?.frontmatter?.tag);
    return tags;
}

function normalizeScopeList(values: unknown): string[] {
    const raw = Array.isArray(values) ? values : String(values || '').split(/[,\n]/);
    return Array.from(new Set(
        raw
            .map((value) => String(value || '').trim())
            .filter(Boolean),
    ));
}

function normalizePathValue(path: string): string {
    return String(path || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
}

function matchesAnyPathScope(path: string, scopes: string[]): boolean {
    const normalizedPath = normalizePathValue(path);
    if (!normalizedPath) return false;
    const pathParts = normalizedPath.split('/').filter(Boolean);
    const subpaths = pathParts.map((_, index) => pathParts.slice(index).join('/'));
    return scopes.some((scope) => {
        const normalizedScope = normalizePathValue(scope);
        if (!normalizedScope) return false;
        if (normalizedScope.includes('*')) {
            return [normalizedPath, ...subpaths].some((candidate) => matchesWildcard(normalizedScope, candidate));
        }
        return normalizedPath === normalizedScope
            || normalizedPath.startsWith(`${normalizedScope}/`)
            || normalizedPath.includes(`/${normalizedScope}/`);
    });
}

function matchesWildcard(pattern: string, value: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i').test(value);
}

function normalizePropertyConditions(raw: unknown): Array<{ key: string; value: string; operator: string }> {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((condition: any) => ({
            key: String(condition?.key || '').trim(),
            value: String(condition?.value || '').trim(),
            operator: String(condition?.operator || 'equals').trim().toLowerCase(),
        }))
        .filter((condition) => !!condition.key);
}

function matchesPropertyCondition(frontmatter: Record<string, unknown>, condition: { key: string; value: string; operator: string }): boolean {
    const actual = getValueCaseInsensitive(frontmatter, condition.key);
    const exists = actual !== undefined && actual !== null;
    const actualText = Array.isArray(actual)
        ? actual.map((value) => String(value ?? '').trim()).join('\n')
        : String(actual ?? '').trim();
    const expected = condition.value;
    const operator = condition.operator;

    if (operator === 'exists') return exists;
    if (operator === 'missing') return !exists;
    if (operator === 'contains') return actualText.toLowerCase().includes(expected.toLowerCase());
    if (operator === 'not-contains') return !actualText.toLowerCase().includes(expected.toLowerCase());
    if (operator === 'not-equals') return actualText.toLowerCase() !== expected.toLowerCase();
    return actualText.toLowerCase() === expected.toLowerCase();
}

function getValueCaseInsensitive(frontmatter: Record<string, unknown>, key: string): unknown {
    if (!frontmatter || !key) return undefined;
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) return frontmatter[key];
    const lower = key.toLowerCase();
    const actualKey = Object.keys(frontmatter).find((candidate) => candidate.toLowerCase() === lower);
    return actualKey ? frontmatter[actualKey] : undefined;
}

function hasFrontmatterKey(frontmatter: Record<string, unknown>, key: string): boolean {
    if (!frontmatter || !key) return false;
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) return true;
    const lower = key.toLowerCase();
    return Object.keys(frontmatter).some((candidate) => candidate.toLowerCase() === lower);
}

function hasPopulatedValue(frontmatter: Record<string, unknown>, key: string): boolean {
    const value = getValueCaseInsensitive(frontmatter, key);
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.some((entry) => !isEmptyScalar(entry));
    return !isEmptyScalar(value);
}

function isEmptyScalar(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    return false;
}
