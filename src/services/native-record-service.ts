import {
  TFile,
  TFolder,
  normalizePath,
  parseYaml,
  stringifyYaml,
} from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import * as logger from '../logger';
import type { GcmTaskRef, GcmTaskRecord } from './task-api-service';
import type { FilePropertiesMutationCause } from './file-properties-service';
import type {
  TpsNativeRecordLayout,
  TpsNativeRecordStorageProfile,
} from '../types';
import {
  deleteValueCaseInsensitive,
  findKeyCaseInsensitive,
  setValueCaseInsensitive,
} from '../core/record-utils';
import { parseStringListInput } from '../utils/list-utils';
import { joinContent, splitContent } from '../utils/task-block-move';
import { parseTaskLine, readInlineFieldValue } from '../utils/task-line-metadata';

export const TPS_NATIVE_RECORD_SCHEMA_VERSION = 1;
export const DEFAULT_NATIVE_RECORD_ROOT = '_records';
export const DEFAULT_NATIVE_RECORD_STORAGE_PROFILE: TpsNativeRecordStorageProfile = {
  identityMode: 'property',
  identityPropertyKey: 'tpsId',
  schemaPropertyKey: 'tpsSchemaVersion',
  identityTagPrefix: 'tps/record',
  kindPropertyKey: 'kind',
  titlePropertyKey: 'title',
  createdPropertyKey: 'createdDate',
  modifiedPropertyKey: 'modifiedDate',
};
export const DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE: TpsNativeRecordStorageProfile = {
  ...DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
  identityMode: 'tag',
};

export interface TpsWritableNativeRecordStorageConfiguration {
  configuredProfile: TpsNativeRecordStorageProfile;
  writeProfile: TpsNativeRecordStorageProfile;
  readAliases: TpsNativeRecordStorageProfile[];
  retiredTagIdentity: boolean;
  requiresSettingsMigration: boolean;
}

export type TpsNativeRecordKind =
  | 'task'
  | 'calendar-event'
  | 'food-entry'
  | 'activity-entry'
  | 'workout-session'
  | 'workout-exercise'
  | 'asset';

export interface TpsNativeRecordEnvelope extends Record<string, unknown> {
  tpsId: string;
  tpsSchemaVersion: number;
  kind: TpsNativeRecordKind;
  title: string;
  createdDate: string;
  modifiedDate: string;
}

export interface TpsNativeRecordHandle {
  file: TFile;
  path: string;
  id: string;
  kind: TpsNativeRecordKind;
  frontmatter: TpsNativeRecordEnvelope;
}

export interface TpsNativeRecordInspection {
  id: string;
  kind: TpsNativeRecordKind;
  schemaVersion: number;
  frontmatter: TpsNativeRecordEnvelope;
  profile: TpsNativeRecordStorageProfile;
}

export interface TpsNativeRecordStorageMigrationResult {
  inspected: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface TpsNativeRecordCreateOptions {
  id?: string;
  now?: Date;
  fileName?: string;
  cause?: FilePropertiesMutationCause;
}

export interface TpsTaskPromotionResult {
  ok: boolean;
  changed: boolean;
  record: TpsNativeRecordHandle | null;
  sourcePath: string;
  sourceLine: number;
  error?: string;
}

type NativeRecordReference = string | TFile | { path?: string; id?: string; tpsId?: string };

interface ParsedNativeRecordDocument {
  bom: string;
  newline: string;
  closer: '---' | '...';
  body: string;
  frontmatter: Record<string, unknown>;
}

const RECORD_FOLDER_BY_KIND: Record<TpsNativeRecordKind, string> = {
  task: 'tasks',
  'calendar-event': 'calendar-events',
  'food-entry': 'food-entries',
  'activity-entry': 'activity-entries',
  'workout-session': 'workout-sessions',
  'workout-exercise': 'workout-exercises',
  asset: 'assets',
};

const CANONICAL_ENVELOPE_KEYS = new Set([
  'tpsid',
  'tpsschemaversion',
  'kind',
  'title',
  'createddate',
  'modifieddate',
]);

function normalizePropertyKey(value: unknown, fallback: string, allowEmpty = false): string {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value ?? '').trim();
  return normalized || (allowEmpty ? '' : fallback);
}

function normalizeIdentityTagPrefix(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .replace(/^#+|\/+$/gu, '')
    .replace(/\s+/gu, '-')
    .replace(/\/{2,}/gu, '/');
  return normalized || DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.identityTagPrefix;
}

export function normalizeNativeRecordStorageProfile(
  value: Partial<TpsNativeRecordStorageProfile> | null | undefined,
): TpsNativeRecordStorageProfile {
  return {
    identityMode: value?.identityMode === 'tag' ? 'tag' : 'property',
    identityPropertyKey: normalizePropertyKey(
      value?.identityPropertyKey,
      DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.identityPropertyKey,
    ),
    schemaPropertyKey: normalizePropertyKey(
      value?.schemaPropertyKey,
      DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.schemaPropertyKey,
    ),
    identityTagPrefix: normalizeIdentityTagPrefix(value?.identityTagPrefix),
    kindPropertyKey: normalizePropertyKey(
      value?.kindPropertyKey,
      DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.kindPropertyKey,
      true,
    ),
    titlePropertyKey: normalizePropertyKey(
      value?.titlePropertyKey,
      DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.titlePropertyKey,
    ),
    createdPropertyKey: normalizePropertyKey(
      value?.createdPropertyKey,
      DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.createdPropertyKey,
      true,
    ),
    modifiedPropertyKey: normalizePropertyKey(
      value?.modifiedPropertyKey,
      DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.modifiedPropertyKey,
      true,
    ),
  };
}

function validateReadableNativeRecordStorageProfile(profileValue: TpsNativeRecordStorageProfile): string[] {
  const profile = normalizeNativeRecordStorageProfile(profileValue);
  const errors: string[] = [];
  if (!profile.titlePropertyKey) errors.push('Title property is required.');
  if (profile.identityMode === 'property' && !profile.kindPropertyKey) {
    errors.push('Kind property is required when record identity uses properties.');
  }
  const keyedFields = [
    ...(profile.identityMode === 'property' ? [profile.identityPropertyKey, profile.schemaPropertyKey] : []),
    profile.kindPropertyKey,
    profile.titlePropertyKey,
    profile.createdPropertyKey,
    profile.modifiedPropertyKey,
  ].filter(Boolean);
  const normalizedKeys = keyedFields.map((key) => key.toLocaleLowerCase());
  if (new Set(normalizedKeys).size !== normalizedKeys.length) {
    errors.push('Every native record system property must use a distinct key.');
  }
  if (profile.identityMode === 'tag' && normalizedKeys.includes('tags')) {
    errors.push('The tags property is reserved for tag-based record identity.');
  }
  return errors;
}

export function validateNativeRecordStorageProfile(profileValue: TpsNativeRecordStorageProfile): string[] {
  const profile = normalizeNativeRecordStorageProfile(profileValue);
  const errors = validateReadableNativeRecordStorageProfile(profile);
  if (profile.identityMode !== 'property') {
    errors.push('Writable native record identity must use properties.');
  }
  const writableKeys = [
    profile.identityPropertyKey,
    profile.schemaPropertyKey,
    profile.kindPropertyKey,
    profile.titlePropertyKey,
    profile.createdPropertyKey,
    profile.modifiedPropertyKey,
  ].filter(Boolean).map((key) => key.toLocaleLowerCase());
  if (writableKeys.includes('tags')) {
    errors.push('The tags property is reserved for user-authored and semantic tags.');
  }
  return [...new Set(errors)];
}

function profileKey(profile: TpsNativeRecordStorageProfile): string {
  return JSON.stringify({
    ...profile,
    identityTagPrefix: profile.identityTagPrefix.toLocaleLowerCase(),
  });
}

function prioritizeReadableStorageAliases(
  values: readonly Partial<TpsNativeRecordStorageProfile>[],
  excludedProfileKey = '',
): TpsNativeRecordStorageProfile[] {
  const seen = new Set<string>();
  const tagProfiles: TpsNativeRecordStorageProfile[] = [];
  const propertyProfiles: TpsNativeRecordStorageProfile[] = [];
  for (const value of values) {
    const profile = normalizeNativeRecordStorageProfile(value);
    if (validateReadableNativeRecordStorageProfile(profile).length > 0) continue;
    const key = profileKey(profile);
    if (key === excludedProfileKey || seen.has(key)) continue;
    seen.add(key);
    (profile.identityMode === 'tag' ? tagProfiles : propertyProfiles).push(profile);
  }
  return [...tagProfiles, ...propertyProfiles.slice(0, 12)];
}

function reserveUniquePropertyKey(
  value: unknown,
  fallback: string,
  occupied: Set<string>,
): string {
  const preferred = normalizePropertyKey(value, fallback);
  const candidates = preferred === fallback ? [preferred] : [preferred, fallback];
  for (const candidate of candidates) {
    const identity = candidate.toLocaleLowerCase();
    if (occupied.has(identity)) continue;
    occupied.add(identity);
    return candidate;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${fallback}${suffix}`;
    const identity = candidate.toLocaleLowerCase();
    if (occupied.has(identity)) continue;
    occupied.add(identity);
    return candidate;
  }
}

export function resolveWritableNativeRecordStorageConfiguration(
  profileValue: Partial<TpsNativeRecordStorageProfile> | null | undefined,
  aliasValues: readonly Partial<TpsNativeRecordStorageProfile>[] | null | undefined = [],
): TpsWritableNativeRecordStorageConfiguration {
  const configuredProfile = normalizeNativeRecordStorageProfile(profileValue);
  const retiredTagIdentity = configuredProfile.identityMode === 'tag';
  const occupiedWriteKeys = new Set<string>(['tags']);
  const titlePropertyKey = reserveUniquePropertyKey(
    configuredProfile.titlePropertyKey,
    DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.titlePropertyKey,
    occupiedWriteKeys,
  );
  const createdPropertyKey = configuredProfile.createdPropertyKey
    ? reserveUniquePropertyKey(
      configuredProfile.createdPropertyKey,
      DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.createdPropertyKey,
      occupiedWriteKeys,
    )
    : '';
  const modifiedPropertyKey = configuredProfile.modifiedPropertyKey
    ? reserveUniquePropertyKey(
      configuredProfile.modifiedPropertyKey,
      DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.modifiedPropertyKey,
      occupiedWriteKeys,
    )
    : '';
  const kindPropertyKey = reserveUniquePropertyKey(
    configuredProfile.kindPropertyKey,
    DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.kindPropertyKey,
    occupiedWriteKeys,
  );
  const identityPropertyKey = reserveUniquePropertyKey(
    configuredProfile.identityPropertyKey,
    DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.identityPropertyKey,
    occupiedWriteKeys,
  );
  const schemaPropertyKey = reserveUniquePropertyKey(
    configuredProfile.schemaPropertyKey,
    DEFAULT_NATIVE_RECORD_STORAGE_PROFILE.schemaPropertyKey,
    occupiedWriteKeys,
  );
  const writeProfile = normalizeNativeRecordStorageProfile({
    ...configuredProfile,
    identityMode: 'property',
    identityPropertyKey,
    schemaPropertyKey,
    kindPropertyKey,
    titlePropertyKey,
    createdPropertyKey,
    modifiedPropertyKey,
  });
  const writeKey = profileKey(writeProfile);
  const requiresSettingsMigration = profileKey(configuredProfile) !== writeKey;
  const values = [
    ...(requiresSettingsMigration ? [configuredProfile] : []),
    ...(Array.isArray(aliasValues) ? aliasValues : []),
  ];
  const readAliases = prioritizeReadableStorageAliases(values, writeKey);
  return {
    configuredProfile,
    writeProfile,
    readAliases,
    retiredTagIdentity,
    requiresSettingsMigration,
  };
}

function decodeIdentityTagSegment(value: string): string {
  if (!value.startsWith('hex-')) return value;
  const hex = value.slice(4);
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(hex)) return '';
  const bytes = new Uint8Array(hex.match(/.{2}/gu)?.map((pair) => Number.parseInt(pair, 16)) || []);
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const canonicalHex = [...new TextEncoder().encode(decoded)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return canonicalHex === hex.toLocaleLowerCase() ? decoded : '';
  } catch {
    return '';
  }
}

function readTagValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => readTagValues(entry));
  return String(value ?? '')
    .split(/[\s,]+/gu)
    .map((entry) => entry.trim().replace(/^#+/u, ''))
    .filter(Boolean);
}

function readValueCaseInsensitive(
  raw: Record<string, unknown>,
  key: string,
): unknown {
  const matchedKey = findKeyCaseInsensitive(raw, key);
  return matchedKey ? raw[matchedKey] : undefined;
}

function stringifyReadableStorageValue(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return String(value ?? '');
}

interface ParsedLegacyIdentityTag {
  rawId: string;
  idCandidates: string[];
  tagOnlyId: string | null;
  requiresPropertyDisambiguation: boolean;
  kind: TpsNativeRecordKind;
}

function parseLegacyIdentityTagEvidence(
  tag: string,
  identityTagPrefix: string,
): ParsedLegacyIdentityTag | null {
  const prefix = `${identityTagPrefix}/v${TPS_NATIVE_RECORD_SCHEMA_VERSION}/`;
  if (!tag.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) return null;
  const remainder = tag.slice(prefix.length);
  const slash = remainder.indexOf('/');
  if (slash < 1 || slash === remainder.length - 1 || remainder.indexOf('/', slash + 1) >= 0) return null;
  const kind = remainder.slice(0, slash);
  const encodedId = remainder.slice(slash + 1);
  if (!Object.prototype.hasOwnProperty.call(RECORD_FOLDER_BY_KIND, kind)) return null;
  if (!/^[A-Za-z0-9_-]+$/u.test(encodedId) && !/^hex-(?:[0-9a-f]{2})+$/iu.test(encodedId)) return null;
  const decodedId = encodedId.startsWith('hex-') ? decodeIdentityTagSegment(encodedId) : '';
  const seen = new Set<string>();
  const idCandidates = [encodedId, decodedId].filter((candidate) => {
    const key = candidate.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    rawId: encodedId,
    idCandidates,
    tagOnlyId: encodedId.startsWith('hex-') ? decodedId || null : encodedId,
    requiresPropertyDisambiguation: encodedId.startsWith('hex-') && !decodedId,
    kind: kind as TpsNativeRecordKind,
  };
}

function identityTagCandidateMatchCount(
  parsedIdentity: ParsedLegacyIdentityTag,
  id: string,
): number {
  const expected = id.trim().toLocaleLowerCase();
  return parsedIdentity.idCandidates.filter((candidate) => (
    candidate.trim().toLocaleLowerCase() === expected
  )).length;
}

function hasInvalidReservedIdentityTagEvidence(
  raw: Record<string, unknown>,
  profiles: TpsNativeRecordStorageProfile[],
): boolean {
  const prefixes: string[] = [];
  const prefixKeys = new Set<string>();
  for (const profile of profiles) {
    if (profile.identityMode !== 'tag') continue;
    const key = profile.identityTagPrefix.toLocaleLowerCase();
    if (prefixKeys.has(key)) continue;
    prefixKeys.add(key);
    prefixes.push(profile.identityTagPrefix);
  }
  if (!prefixes.length) return false;
  const reservedTags = readTagValues(readValueCaseInsensitive(raw, 'tags')).filter((tag) => (
    prefixes.some((prefix) => tag.toLocaleLowerCase().startsWith(`${prefix.toLocaleLowerCase()}/`))
  ));
  if (reservedTags.length === 0) return false;
  if (reservedTags.length !== 1) return true;
  const matchingPrefixes = prefixes.filter((prefix) => (
    reservedTags[0].toLocaleLowerCase().startsWith(`${prefix.toLocaleLowerCase()}/`)
  ));
  if (matchingPrefixes.length !== 1) return true;
  const parsedIdentity = parseLegacyIdentityTagEvidence(reservedTags[0], matchingPrefixes[0]);
  if (!parsedIdentity) return true;
  if (parsedIdentity.requiresPropertyDisambiguation) return true;
  const propertyInspections = profiles
    .filter((profile) => profile.identityMode === 'property')
    .map((profile) => inspectWithProfile(raw, profile))
    .filter((inspection): inspection is TpsNativeRecordInspection => inspection !== null);
  if (propertyInspections.length > 0) {
    return propertyInspections.some((inspection) => (
      inspection.kind !== parsedIdentity.kind
      || identityTagCandidateMatchCount(parsedIdentity, inspection.id) !== 1
    ));
  }
  return !profiles.some((profile) => (
    profile.identityMode === 'tag' && inspectWithProfile(raw, profile) !== null
  ));
}

function inspectWithProfile(
  raw: Record<string, unknown>,
  profile: TpsNativeRecordStorageProfile,
): TpsNativeRecordInspection | null {
  let id = '';
  let kind = '';
  let schemaVersion = 0;
  if (profile.identityMode === 'tag') {
    const matches = readTagValues(readValueCaseInsensitive(raw, 'tags'))
      .filter((tag) => tag.toLocaleLowerCase().startsWith(`${profile.identityTagPrefix.toLocaleLowerCase()}/`));
    if (matches.length !== 1) return null;
    const parsedIdentity = parseLegacyIdentityTagEvidence(matches[0], profile.identityTagPrefix);
    if (!parsedIdentity || parsedIdentity.requiresPropertyDisambiguation) return null;
    schemaVersion = TPS_NATIVE_RECORD_SCHEMA_VERSION;
    kind = parsedIdentity.kind;
    id = parsedIdentity.tagOnlyId || '';
  } else {
    id = stringifyReadableStorageValue(
      readValueCaseInsensitive(raw, profile.identityPropertyKey),
    ).trim();
    schemaVersion = Number(readValueCaseInsensitive(raw, profile.schemaPropertyKey));
    kind = profile.kindPropertyKey
      ? stringifyReadableStorageValue(readValueCaseInsensitive(raw, profile.kindPropertyKey)).trim()
      : '';
  }
  if (schemaVersion !== TPS_NATIVE_RECORD_SCHEMA_VERSION || !id) return null;
  if (profile.kindPropertyKey) {
    const authoredKind = stringifyReadableStorageValue(
      readValueCaseInsensitive(raw, profile.kindPropertyKey),
    ).trim();
    if (kind && authoredKind && kind !== authoredKind) return null;
    kind = kind || authoredKind;
  }
  if (!Object.prototype.hasOwnProperty.call(RECORD_FOLDER_BY_KIND, kind)) return null;
  const title = stringifyReadableStorageValue(
    readValueCaseInsensitive(raw, profile.titlePropertyKey),
  ).trim();
  if (!title) return null;
  const createdDate = profile.createdPropertyKey
    ? stringifyReadableStorageValue(readValueCaseInsensitive(raw, profile.createdPropertyKey))
    : '';
  const modifiedDate = profile.modifiedPropertyKey
    ? stringifyReadableStorageValue(readValueCaseInsensitive(raw, profile.modifiedPropertyKey))
    : '';
  const frontmatter = { ...raw } as TpsNativeRecordEnvelope;
  setValueCaseInsensitive(frontmatter, 'tpsId', id);
  setValueCaseInsensitive(frontmatter, 'tpsSchemaVersion', schemaVersion);
  setValueCaseInsensitive(frontmatter, 'kind', kind as TpsNativeRecordKind);
  setValueCaseInsensitive(frontmatter, 'title', title);
  setValueCaseInsensitive(frontmatter, 'createdDate', createdDate);
  setValueCaseInsensitive(frontmatter, 'modifiedDate', modifiedDate);
  return {
    id,
    kind: kind as TpsNativeRecordKind,
    schemaVersion,
    frontmatter,
    profile,
  };
}

function storagePropertyKeys(profile: TpsNativeRecordStorageProfile): string[] {
  return [
    ...(profile.identityMode === 'property'
      ? [profile.identityPropertyKey, profile.schemaPropertyKey]
      : []),
    profile.kindPropertyKey,
    profile.titlePropertyKey,
    profile.createdPropertyKey,
    profile.modifiedPropertyKey,
  ].filter(Boolean);
}

function storageKeys(profile: TpsNativeRecordStorageProfile): string[] {
  return storagePropertyKeys(profile).filter((key) => key.toLocaleLowerCase() !== 'tags');
}

function propertyProfileUsesTags(profile: TpsNativeRecordStorageProfile): boolean {
  return profile.identityMode === 'property'
    && storagePropertyKeys(profile).some((key) => key.toLocaleLowerCase() === 'tags');
}

function selectApplicableReadableProfiles(
  raw: Record<string, unknown>,
  profiles: TpsNativeRecordStorageProfile[],
  writeProfile: TpsNativeRecordStorageProfile,
): TpsNativeRecordStorageProfile[] {
  if (!inspectWithProfile(raw, writeProfile)) return profiles;
  const writeKey = profileKey(writeProfile);
  return profiles.filter((profile) => {
    if (profileKey(profile) === writeKey || profile.identityMode === 'tag') return true;
    if (propertyProfileUsesTags(profile)) return false;
    return inspectWithProfile(raw, profile) !== null;
  });
}

function hasInvalidPropertyIdentityEvidence(
  raw: Record<string, unknown>,
  profiles: TpsNativeRecordStorageProfile[],
): boolean {
  const propertyProfiles = profiles.filter((profile) => profile.identityMode === 'property');
  const inspections = new Map<TpsNativeRecordStorageProfile, TpsNativeRecordInspection | null>();
  const explainedMarkers = new Set<string>();
  for (const profile of propertyProfiles) {
    const inspection = inspectWithProfile(raw, profile);
    inspections.set(profile, inspection);
    if (!inspection) continue;
    explainedMarkers.add(`id:${profile.identityPropertyKey.toLocaleLowerCase()}`);
    explainedMarkers.add(`schema:${profile.schemaPropertyKey.toLocaleLowerCase()}`);
  }
  for (const profile of propertyProfiles) {
    if (inspections.get(profile)) continue;
    const idPresent = findKeyCaseInsensitive(raw, profile.identityPropertyKey) !== null;
    const schemaPresent = findKeyCaseInsensitive(raw, profile.schemaPropertyKey) !== null;
    if (!idPresent && !schemaPresent) continue;
    if (idPresent && !explainedMarkers.has(`id:${profile.identityPropertyKey.toLocaleLowerCase()}`)) return true;
    if (schemaPresent && !explainedMarkers.has(`schema:${profile.schemaPropertyKey.toLocaleLowerCase()}`)) return true;
  }
  return false;
}

function hasDuplicateReadableStorageKeys(
  raw: Record<string, unknown>,
  profiles: TpsNativeRecordStorageProfile[],
): boolean {
  const storageKeyNames = new Set([
    'tags',
    ...profiles.flatMap(storageKeys).map((key) => key.toLocaleLowerCase()),
  ]);
  const seen = new Set<string>();
  for (const key of Object.keys(raw)) {
    const folded = key.toLocaleLowerCase();
    if (!storageKeyNames.has(folded)) continue;
    if (seen.has(folded)) return true;
    seen.add(folded);
  }
  return false;
}

function hasAmbiguousPropertyTagsEvidence(
  raw: Record<string, unknown>,
  profiles: TpsNativeRecordStorageProfile[],
): boolean {
  const matchedPropertyOwners = profiles.filter((profile) => (
    propertyProfileUsesTags(profile)
      && inspectWithProfile(raw, profile) !== null
  ));
  if (!matchedPropertyOwners.length) return false;
  if (matchedPropertyOwners.length > 1) return true;
  if (profiles.some((profile) => (
    profile.identityMode === 'tag' && inspectWithProfile(raw, profile) !== null
  ))) return true;
  const tagsKey = findKeyCaseInsensitive(raw, 'tags');
  const tagsValue = tagsKey ? raw[tagsKey] : undefined;
  return Boolean(
    tagsKey
    && typeof tagsValue === 'object'
    && tagsValue !== null
    && !(tagsValue instanceof Date),
  );
}

function hasInvalidReadableIdentityEvidence(
  raw: Record<string, unknown>,
  profiles: TpsNativeRecordStorageProfile[],
  writeProfile: TpsNativeRecordStorageProfile,
): boolean {
  return hasInvalidReservedIdentityTagEvidence(raw, profiles)
    || hasInvalidPropertyIdentityEvidence(raw, profiles)
    || hasDuplicateReadableStorageKeys(raw, profiles)
    || hasAmbiguousPropertyTagsEvidence(raw, profiles)
    || hasConflictingMatchedTimestamps(raw, profiles, writeProfile)
    || hasConflictingMatchedTitles(raw, profiles, writeProfile);
}

function matchedTimestampValues(
  matches: readonly TpsNativeRecordInspection[],
  key: 'createdDate' | 'modifiedDate',
): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const match of matches) {
    const value = stringifyReadableStorageValue(match.frontmatter[key]);
    if (!value.trim() || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function hasConflictingMatchedTimestamps(
  raw: Record<string, unknown>,
  profiles: TpsNativeRecordStorageProfile[],
  writeProfile: TpsNativeRecordStorageProfile,
): boolean {
  const matches = profiles
    .map((profile) => inspectWithProfile(raw, profile))
    .filter((value): value is TpsNativeRecordInspection => value !== null);
  const current = inspectWithProfile(raw, writeProfile);
  return (['createdDate', 'modifiedDate'] as const).some((key) => {
    if (current && stringifyReadableStorageValue(current.frontmatter[key]).trim()) return false;
    return matchedTimestampValues(matches, key).length > 1;
  });
}

function hasConflictingMatchedTitles(
  raw: Record<string, unknown>,
  profiles: TpsNativeRecordStorageProfile[],
  writeProfile: TpsNativeRecordStorageProfile,
): boolean {
  if (inspectWithProfile(raw, writeProfile)) return false;
  const titles = new Set(profiles
    .map((profile) => inspectWithProfile(raw, profile))
    .filter((value): value is TpsNativeRecordInspection => value !== null)
    .map((match) => stringifyReadableStorageValue(match.frontmatter.title).trim())
    .filter(Boolean));
  return titles.size > 1;
}

interface NativeRecordMatchSet {
  inspection: TpsNativeRecordInspection;
  matchedProfiles: TpsNativeRecordStorageProfile[];
  recognizedIdentityTagProfiles: TpsNativeRecordStorageProfile[];
}

function recognizedIdentityTagProfiles(
  raw: Record<string, unknown>,
  profiles: TpsNativeRecordStorageProfile[],
  inspection: TpsNativeRecordInspection,
): TpsNativeRecordStorageProfile[] {
  const tags = readTagValues(readValueCaseInsensitive(raw, 'tags'));
  return profiles.filter((profile) => (
    profile.identityMode === 'tag' && tags.some((tag) => {
      const parsedIdentity = parseLegacyIdentityTagEvidence(tag, profile.identityTagPrefix);
      return Boolean(
        parsedIdentity
        && parsedIdentity.kind === inspection.kind
        && identityTagCandidateMatchCount(parsedIdentity, inspection.id) === 1
      );
    })
  ));
}

function inspectNativeRecordMatchSet(
  raw: Record<string, unknown>,
  profiles: TpsNativeRecordStorageProfile[],
  writeProfile: TpsNativeRecordStorageProfile,
): NativeRecordMatchSet | null {
  const applicableProfiles = selectApplicableReadableProfiles(raw, profiles, writeProfile);
  if (hasInvalidReadableIdentityEvidence(raw, applicableProfiles, writeProfile)) return null;
  const allMatches = applicableProfiles
    .map((profile) => inspectWithProfile(raw, profile))
    .filter((value): value is TpsNativeRecordInspection => value !== null);
  const propertyMatches = allMatches.filter((match) => match.profile.identityMode === 'property');
  const propertyIdentity = propertyMatches[0];
  const matches = propertyIdentity
    ? allMatches.filter((match) => (
      match.profile.identityMode === 'property'
      || (match.id.trim().toLocaleLowerCase() === propertyIdentity.id.trim().toLocaleLowerCase()
        && match.kind === propertyIdentity.kind)
    ))
    : allMatches;
  if (!matches.length) return null;
  const identities = new Set(matches.map((match) => (
    `${match.id.trim().toLocaleLowerCase()}\u0000${match.kind}`
  )));
  if (identities.size !== 1) return null;
  const inspection: TpsNativeRecordInspection = {
    ...matches[0],
    frontmatter: { ...matches[0].frontmatter },
  };
  for (const key of ['createdDate', 'modifiedDate'] as const) {
    if (stringifyReadableStorageValue(inspection.frontmatter[key]).trim()) continue;
    const [fallback] = matchedTimestampValues(matches, key);
    if (fallback) setValueCaseInsensitive(inspection.frontmatter, key, fallback);
  }
  const seen = new Set<string>();
  const matchedProfiles = matches.map((match) => match.profile).filter((profile) => {
    const key = profileKey(profile);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    inspection,
    matchedProfiles,
    recognizedIdentityTagProfiles: recognizedIdentityTagProfiles(
      raw,
      applicableProfiles,
      inspection,
    ),
  };
}

function legacyCleanupProfiles(
  raw: Record<string, unknown>,
  writeProfile: TpsNativeRecordStorageProfile,
  matchedProfiles: readonly TpsNativeRecordStorageProfile[],
): TpsNativeRecordStorageProfile[] | null {
  const writeKey = profileKey(writeProfile);
  const seen = new Set<string>();
  const cleanupProfiles = matchedProfiles.filter((profile) => {
    const key = profileKey(profile);
    if (key === writeKey || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const propertyTagsOwners = cleanupProfiles.filter((profile) => (
    propertyProfileUsesTags(profile)
  ));
  if (propertyTagsOwners.length > 1) return null;
  if (propertyTagsOwners.length === 1) {
    if (cleanupProfiles.some((profile) => profile.identityMode === 'tag')) return null;
    const tagsKey = findKeyCaseInsensitive(raw, 'tags');
    const tagsValue = tagsKey ? raw[tagsKey] : undefined;
    if (
      tagsKey
      && typeof tagsValue === 'object'
      && tagsValue !== null
      && !(tagsValue instanceof Date)
    ) return null;
  }
  return cleanupProfiles;
}

function removeIdentityTags(
  frontmatter: Record<string, unknown>,
  profiles: TpsNativeRecordStorageProfile[],
): void {
  const tagProfiles = profiles.filter((profile) => profile.identityMode === 'tag');
  const tagsKey = findKeyCaseInsensitive(frontmatter, 'tags');
  if (!tagProfiles.length || !tagsKey) return;
  const tags = readTagValues(frontmatter[tagsKey]).filter((tag) => !tagProfiles.some((profile) => (
    parseLegacyIdentityTagEvidence(tag, profile.identityTagPrefix) !== null
  )));
  if (tags.length) setValueCaseInsensitive(frontmatter, tagsKey, tags);
  else deleteValueCaseInsensitive(frontmatter, tagsKey);
}

function applyEnvelopeToRawFrontmatter(
  raw: Record<string, unknown>,
  envelope: TpsNativeRecordEnvelope,
  profile: TpsNativeRecordStorageProfile,
  matchedProfiles: readonly TpsNativeRecordStorageProfile[] = [],
  identityTagProfiles: readonly TpsNativeRecordStorageProfile[] = [],
): Record<string, unknown> | null {
  const cleanupProfiles = legacyCleanupProfiles(raw, profile, matchedProfiles);
  if (!cleanupProfiles) return null;
  const next = { ...envelope };
  removeIdentityTags(next, [...cleanupProfiles, ...identityTagProfiles]);
  const propertyTagsOwned = cleanupProfiles.some((cleanupProfile) => (
    propertyProfileUsesTags(cleanupProfile)
  ));
  const protectedKeys = new Set(
    [profile, ...cleanupProfiles].flatMap(storageKeys).map((key) => key.toLocaleLowerCase()),
  );
  for (const key of Object.keys(next)) {
    const lower = key.toLocaleLowerCase();
    if (
      CANONICAL_ENVELOPE_KEYS.has(lower)
      || protectedKeys.has(lower)
      || (propertyTagsOwned && lower === 'tags')
    ) delete next[key];
  }

  next[profile.identityPropertyKey] = envelope.tpsId;
  next[profile.schemaPropertyKey] = envelope.tpsSchemaVersion;
  if (profile.kindPropertyKey) next[profile.kindPropertyKey] = envelope.kind;
  next[profile.titlePropertyKey] = envelope.title;
  if (profile.createdPropertyKey) next[profile.createdPropertyKey] = envelope.createdDate;
  if (profile.modifiedPropertyKey) next[profile.modifiedPropertyKey] = envelope.modifiedDate;
  return next;
}

const SHARED_TASK_FIELDS = [
  'priority',
  'scheduled',
  'due',
  'timeEstimate',
  'parents',
  'recurrenceRule',
  'completedDate',
] as const;

export function normalizeNativeRecordRoot(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : DEFAULT_NATIVE_RECORD_ROOT;
  if (raw === '' || raw === '/' || raw === '.') return '';
  const normalized = normalizePath(raw
    .replace(/^\/+|\/+$/gu, ''));
  if (!normalized || normalized === '.' || normalized.toLocaleLowerCase() === '.obsidian') {
    return DEFAULT_NATIVE_RECORD_ROOT;
  }
  return normalized;
}

export function normalizeNativeRecordLayout(value: unknown): TpsNativeRecordLayout {
  return value === 'flat-root' ? 'flat-root' : 'kind-folders';
}

export function buildNativeRecordPath(
  root: string,
  kind: TpsNativeRecordKind,
  id: string,
  layout: TpsNativeRecordLayout = 'kind-folders',
  fileName?: string,
): string {
  const safeId = String(fileName || id || '')
    .trim()
    .replace(/\.md$/iu, '')
    .replace(/\s+/gu, ' ')
    .replace(/[\\/:*?"<>|#^\[\]]+/gu, '-')
    .replace(/\.{2,}/gu, '-')
    .replace(/^[.\s-]+|[.\s-]+$/gu, '')
    .slice(0, 180);
  if (!safeId) throw new Error('Native record ID cannot be represented as a filename.');
  const normalizedRoot = normalizeNativeRecordRoot(root);
  const segments = [normalizedRoot];
  if (normalizeNativeRecordLayout(layout) === 'kind-folders') segments.push(RECORD_FOLDER_BY_KIND[kind]);
  segments.push(`${safeId}.md`);
  return normalizePath(segments.filter(Boolean).join('/'));
}

/**
 * Native mode keeps quick, undated reminders inline. Once a task carries a
 * scheduling boundary it needs an independently addressable record so Bases,
 * TishOS, and other file-backed consumers can track it without synthesizing a
 * line row.
 */
export function taskLineNeedsNativeRecord(rawLine: string): boolean {
  if (!parseTaskLine(rawLine)) return false;
  return ['scheduled', 'due'].some((key) => (
    String(readInlineFieldValue(rawLine, key) || '').trim().length > 0
  ));
}

export function parseNativeRecordDocument(content: string): ParsedNativeRecordDocument | null {
  const source = String(content || '');
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const withoutBom = bom ? source.slice(1) : source;
  const newline = withoutBom.match(/\r\n|\n|\r/u)?.[0] || '\n';
  const lines = withoutBom.split(/\r\n|\n|\r/u);
  if (!/^---[\t ]*$/u.test(String(lines[0] || ''))) return null;
  let closerIndex = -1;
  let closer: '---' | '...' = '---';
  for (let index = 1; index < lines.length; index += 1) {
    const markerMatch = String(lines[index] || '').match(/^(---|\.\.\.)[\t ]*$/u);
    if (!markerMatch) continue;
    closerIndex = index;
    closer = markerMatch[1] as '---' | '...';
    break;
  }
  if (closerIndex < 0) return null;
  try {
    const parsed = parseYaml(lines.slice(1, closerIndex).join(newline));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {
      bom,
      newline,
      closer,
      body: lines.slice(closerIndex + 1).join(newline),
      frontmatter: parsed as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export function serializeNativeRecordDocument(document: ParsedNativeRecordDocument): string {
  const yaml = stringifyYaml(document.frontmatter).trimEnd();
  const body = String(document.body || '');
  return `${document.bom}---${document.newline}${yaml}${document.newline}${document.closer}${document.newline}${body}`;
}

export function isNativeRecordEnvelope(value: unknown): value is TpsNativeRecordEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Number(record.tpsSchemaVersion) === TPS_NATIVE_RECORD_SCHEMA_VERSION
    && typeof record.tpsId === 'string'
    && record.tpsId.trim().length > 0
    && typeof record.kind === 'string'
    && Object.prototype.hasOwnProperty.call(RECORD_FOLDER_BY_KIND, record.kind)
    && typeof record.title === 'string'
    && typeof record.createdDate === 'string'
    && typeof record.modifiedDate === 'string';
}

/**
 * Authoritative Markdown record storage for the opt-in native TPS profile.
 * This service never writes a non-Markdown source file and never creates a
 * legacy companion note.
 */
export class NativeRecordService {
  readonly version = 4;
  private setupComplete = false;
  private readonly newlyCreatedFiles = new WeakSet<TFile>();
  private readonly draftEligibilityTimers = new WeakMap<TFile, ReturnType<typeof setTimeout>>();
  private readonly draftAdoptions = new WeakMap<TFile, Promise<void>>();
  private readonly idsByPath = new Map<string, string>();
  private readonly pathsById = new Map<string, Set<string>>();
  private readonly recordsByPath = new Map<string, TpsNativeRecordEnvelope>();
  private readonly blockedIdentityEvidencePaths = new Set<string>();
  private readonly blockedPathsById = new Map<string, Set<string>>();
  private readonly assetPathsBySourcePath = new Map<string, Set<string>>();
  private readonly inFlightCreateIds = new Set<string>();

  constructor(private readonly plugin: TPSGlobalContextMenuPlugin) {}

  setup(): void {
    if (this.setupComplete) return;
    this.setupComplete = true;
    this.rebuildIndex();
    this.plugin.registerEvent(this.plugin.app.metadataCache.on('changed', (file, _data, cache) => {
      this.indexFile(file, cache?.frontmatter);
      if (this.newlyCreatedFiles.has(file)) void this.adoptNewTaskDraft(file);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('create', (file) => {
      if (!(file instanceof TFile)) return;
      this.newlyCreatedFiles.add(file);
      const timer = globalThis.setTimeout(() => {
        this.newlyCreatedFiles.delete(file);
        this.draftEligibilityTimers.delete(file);
      }, 10_000);
      (timer as unknown as { unref?: () => void }).unref?.();
      this.draftEligibilityTimers.set(file, timer);
      this.indexFile(file);
      void this.adoptNewTaskDraft(file);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('delete', (file) => {
      if (file instanceof TFile) this.removePath(file.path);
    }));
    this.plugin.registerEvent(this.plugin.app.vault.on('rename', (file, oldPath) => {
      void this.handleRecordRename(file, oldPath);
    }));
  }

  isEnabled(): boolean {
    return this.plugin.settings.dataArchitectureMode === 'native-records';
  }

  getMode(): 'legacy' | 'native-records' {
    return this.isEnabled() ? 'native-records' : 'legacy';
  }

  getRootPath(): string {
    return normalizeNativeRecordRoot(this.plugin.settings.nativeRecordRootPath);
  }

  getLayout(): TpsNativeRecordLayout {
    return normalizeNativeRecordLayout(this.plugin.settings.nativeRecordLayout);
  }

  getStorageProfile(): TpsNativeRecordStorageProfile {
    return this.getStorageConfiguration().writeProfile;
  }

  getReadableStorageProfiles(): TpsNativeRecordStorageProfile[] {
    const configuration = this.getStorageConfiguration();
    const values = [
      configuration.writeProfile,
      ...configuration.readAliases,
      DEFAULT_NATIVE_RECORD_STORAGE_PROFILE,
      DEFAULT_LEGACY_NATIVE_RECORD_TAG_PROFILE,
    ].map((profile) => normalizeNativeRecordStorageProfile(profile));
    const seen = new Set<string>();
    return values.filter((profile) => {
      if (validateReadableNativeRecordStorageProfile(profile).length > 0) return false;
      const key = profileKey(profile);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private getConfiguredStorageProfile(): TpsNativeRecordStorageProfile {
    return normalizeNativeRecordStorageProfile({
      identityMode: this.plugin.settings.nativeRecordIdentityMode,
      identityPropertyKey: this.plugin.settings.nativeRecordIdentityPropertyKey,
      schemaPropertyKey: this.plugin.settings.nativeRecordSchemaPropertyKey,
      identityTagPrefix: this.plugin.settings.nativeRecordIdentityTagPrefix,
      kindPropertyKey: this.plugin.settings.nativeRecordKindPropertyKey,
      titlePropertyKey: this.plugin.settings.nativeRecordTitlePropertyKey,
      createdPropertyKey: this.plugin.settings.nativeRecordCreatedPropertyKey,
      modifiedPropertyKey: this.plugin.settings.nativeRecordModifiedPropertyKey,
    });
  }

  private getStorageConfiguration(): TpsWritableNativeRecordStorageConfiguration {
    return resolveWritableNativeRecordStorageConfiguration(
      this.getConfiguredStorageProfile(),
      this.plugin.settings.nativeRecordStorageAliases,
    );
  }

  inspect(frontmatter: unknown): TpsNativeRecordInspection | null {
    if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) return null;
    const raw = frontmatter as Record<string, unknown>;
    return inspectNativeRecordMatchSet(
      raw,
      this.getReadableStorageProfiles(),
      this.getStorageProfile(),
    )?.inspection || null;
  }

  isRecordFile(file: unknown): file is TFile {
    if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== 'md') return false;
    const cached = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    return this.inspect(cached) !== null || this.idsByPath.has(file.path);
  }

  async create(
    kind: TpsNativeRecordKind,
    properties: Record<string, unknown>,
    options: TpsNativeRecordCreateOptions = {},
  ): Promise<TpsNativeRecordHandle> {
    this.assertEnabled();
    this.assertValidStorageProfile();
    if (!Object.prototype.hasOwnProperty.call(RECORD_FOLDER_BY_KIND, kind)) {
      throw new Error(`Unsupported TPS native record kind: ${String(kind)}`);
    }
    const now = options.now instanceof Date ? options.now : new Date();
    const timestamp = now.toISOString();
    const id = String(options.id || this.generateId(kind)).trim();
    if (!id) throw new Error('TPS native record ID is required.');
    const reservationKey = this.idKey(id);
    if (this.inFlightCreateIds.has(reservationKey)) {
      throw new Error(`TPS native record ID creation is already in progress: ${id}`);
    }
    this.inFlightCreateIds.add(reservationKey);
    try {
      this.rebuildIndex();
      if (this.pathsById.has(reservationKey) || this.blockedPathsById.has(reservationKey)) {
        throw new Error(`TPS native record ID already exists: ${id}`);
      }

      const title = String(properties.title || '').replace(/\s+/gu, ' ').trim();
      if (!title) throw new Error('TPS native records require a title.');
      const userProperties = this.copyUserProperties(properties);
      const frontmatter: TpsNativeRecordEnvelope = {
        ...userProperties,
        tpsId: id,
        tpsSchemaVersion: TPS_NATIVE_RECORD_SCHEMA_VERSION,
        kind,
        title,
        createdDate: timestamp,
        modifiedDate: timestamp,
      };
      const writeProfile = this.getStorageProfile();
      const readableProfiles = this.getReadableStorageProfiles();
      const preliminaryFrontmatter = applyEnvelopeToRawFrontmatter(
        userProperties,
        frontmatter,
        writeProfile,
        [],
      );
      const preliminaryMatch = preliminaryFrontmatter
        ? inspectNativeRecordMatchSet(preliminaryFrontmatter, readableProfiles, writeProfile)
        : null;
      const persistedFrontmatter = preliminaryFrontmatter && preliminaryMatch
        ? applyEnvelopeToRawFrontmatter(
          preliminaryFrontmatter,
          preliminaryMatch.inspection.frontmatter,
          writeProfile,
          preliminaryMatch.matchedProfiles,
          preliminaryMatch.recognizedIdentityTagProfiles,
        )
        : null;
      const persistedInspection = persistedFrontmatter
        ? inspectNativeRecordMatchSet(persistedFrontmatter, readableProfiles, writeProfile)?.inspection
        : null;
      if (!persistedInspection || persistedInspection.id !== id || persistedInspection.kind !== kind) {
        throw new Error('TPS native record properties contain conflicting or invalid storage identity evidence.');
      }
      const path = this.availableRecordPath(kind, id, options.fileName);
      await this.ensureParentFolder(path);
      this.rebuildIndex();
      if (this.pathsById.has(reservationKey) || this.blockedPathsById.has(reservationKey)) {
        throw new Error(`TPS native record ID already exists: ${id}`);
      }
      const content = serializeNativeRecordDocument({
        bom: '',
        newline: '\n',
        closer: '---',
        body: '',
        frontmatter: persistedFrontmatter,
      });
      const file = await this.plugin.app.vault.create(path, content);
      const persistedEnvelope = persistedInspection.frontmatter;
      this.indexFile(file, persistedFrontmatter);
      this.plugin.entityIndexService?.upsertFile(file, persistedEnvelope);
      this.notify([file.path], options.cause, 'native-record-create');
      logger.flow('NativeRecords', 'create:done', { kind, id, path: file.path });
      return this.toHandle(file, persistedEnvelope);
    } finally {
      this.inFlightCreateIds.delete(reservationKey);
    }
  }

  async rename(
    reference: NativeRecordReference,
    fileName: string,
    cause?: FilePropertiesMutationCause,
  ): Promise<TpsNativeRecordHandle | null> {
    this.assertEnabled();
    const record = await this.resolve(reference);
    if (!record) return null;
    if (!this.hasUniquePathOwnership(record.id, record.path)) {
      this.rebuildIndex();
      if (!this.hasUniquePathOwnership(record.id, record.path)) return null;
    }
    const nextPath = this.availableRecordPath(record.kind, record.id, fileName, record.file);
    if (nextPath === record.file.path) return record;
    const oldPath = record.file.path;
    await this.ensureParentFolder(nextPath);
    this.rebuildIndex();
    if (!this.recordsByPath.has(oldPath)) {
      this.indexFile(record.file, record.frontmatter);
    }
    if (!this.hasUniquePathOwnership(record.id, oldPath)) return null;
    if (this.plugin.app.vault.getFileByPath(oldPath) !== record.file) return null;
    await this.plugin.app.fileManager.renameFile(record.file, nextPath);
    this.removePath(oldPath);
    this.indexFile(record.file, record.frontmatter);
    this.notify([oldPath, record.file.path], cause, 'native-record-rename');
    logger.flow('NativeRecords', 'rename:done', {
      kind: record.kind,
      id: record.id,
      oldPath,
      path: record.file.path,
    });
    return this.toHandle(record.file, record.frontmatter);
  }

  async createAsset(
    source: TFile,
    properties: Record<string, unknown> = {},
    options: TpsNativeRecordCreateOptions = {},
  ): Promise<TpsNativeRecordHandle> {
    this.assertAssetSource(source);
    const existing = this.resolveAssetCached(source);
    if (existing) return existing;
    if ((this.assetPathsBySourcePath.get(normalizePath(source.path))?.size || 0) > 1) {
      throw new Error(`Multiple asset records refer to ${source.path}; resolve the duplicate records before writing.`);
    }
    return this.create('asset', {
      ...properties,
      title: String(properties.title || source.basename).trim() || source.basename,
      sourcePath: source.path,
      sourceExtension: source.extension.toLocaleLowerCase(),
    }, options);
  }

  ensureAsset(
    source: TFile,
    properties: Record<string, unknown> = {},
    options: TpsNativeRecordCreateOptions = {},
  ): Promise<TpsNativeRecordHandle> {
    return this.createAsset(source, properties, options);
  }

  resolveAssetCached(source: TFile): TpsNativeRecordHandle | null {
    if (!(source instanceof TFile)) return null;
    const paths = this.assetPathsBySourcePath.get(normalizePath(source.path));
    if (!paths || paths.size !== 1) return null;
    const [path] = paths;
    const file = this.plugin.app.vault.getFileByPath(path);
    const frontmatter = this.recordsByPath.get(path);
    return file instanceof TFile && frontmatter?.kind === 'asset'
      ? this.toHandle(file, frontmatter)
      : null;
  }

  async resolveAsset(source: TFile): Promise<TpsNativeRecordHandle | null> {
    if (!(source instanceof TFile)) return null;
    const cached = this.resolveAssetCached(source);
    if (cached) return cached;
    this.rebuildIndex();
    return this.resolveAssetCached(source);
  }

  async resolve(reference: NativeRecordReference): Promise<TpsNativeRecordHandle | null> {
    const directFile = reference instanceof TFile
      ? reference
      : typeof reference === 'string'
        ? this.plugin.app.vault.getFileByPath(normalizePath(reference))
        : reference?.path
          ? this.plugin.app.vault.getFileByPath(normalizePath(String(reference.path)))
          : null;
    if (directFile instanceof TFile) {
      const directRecord = await this.readHandle(directFile);
      if (!directRecord) return null;
      this.rebuildIndex();
      if (!this.recordsByPath.has(directRecord.path)) {
        this.indexFile(directFile, directRecord.frontmatter);
      }
      return this.hasUniquePathOwnership(directRecord.id, directRecord.path)
        ? directRecord
        : null;
    }

    const id = typeof reference === 'string'
      ? reference.trim()
      : reference instanceof TFile
        ? ''
        : String(reference?.id || reference?.tpsId || '').trim();
    if (!id) return null;
    const key = this.idKey(id);
    let candidates = this.pathsById.get(key);
    if ((!candidates || candidates.size === 0) && !this.blockedPathsById.has(key)) {
      this.rebuildIndex();
      candidates = this.pathsById.get(key);
    }
    if (this.blockedPathsById.has(key)) return null;
    if (!candidates || candidates.size !== 1) return null;
    const [path] = candidates;
    const file = this.plugin.app.vault.getFileByPath(path);
    return file instanceof TFile ? this.readHandle(file) : null;
  }

  async update(
    reference: NativeRecordReference,
    updates: Record<string, unknown>,
    cause: FilePropertiesMutationCause = { kind: 'user' },
  ): Promise<TpsNativeRecordHandle | null> {
    this.assertValidStorageProfile();
    const record = await this.resolve(reference);
    if (!record) return null;
    if (!this.hasUniquePathOwnership(record.id, record.path)) {
      this.rebuildIndex();
      if (!this.hasUniquePathOwnership(record.id, record.path)) return null;
    }
    const writeProfile = this.getStorageProfile();
    const readableProfiles = this.getReadableStorageProfiles();
    const ownedKeys = this.uniquePropertyKeys([
      ...storageKeys(writeProfile),
      ...readableProfiles.flatMap(storageKeys),
      'tags',
      ...Object.keys(updates || {}),
    ]);
    let nextEnvelope: TpsNativeRecordEnvelope | null = null;
    let persistedFrontmatter: Record<string, unknown> | null = null;
    let mutationAccepted = false;
    const changed = await this.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(
      record.file,
      ownedKeys,
      (frontmatter) => {
        this.rebuildIndex();
        if (!this.recordsByPath.has(record.path)) this.indexFile(record.file, frontmatter);
        const matchSet = inspectNativeRecordMatchSet(frontmatter, readableProfiles, writeProfile);
        const inspection = matchSet?.inspection;
        if (!matchSet || !inspection || inspection.id !== record.id || inspection.kind !== record.kind) return;
        if (!this.hasUniquePathOwnership(inspection.id, record.path)) return;
        const canonical = { ...inspection.frontmatter };
        const keysToSynchronize: string[] = [
          writeProfile.identityPropertyKey,
          writeProfile.schemaPropertyKey,
        ];
        for (const [key, value] of Object.entries(updates || {})) {
          const normalizedKey = key.trim().toLocaleLowerCase();
          if (normalizedKey === 'title') {
            if (value != null) {
              setValueCaseInsensitive(canonical, 'title', String(value).replace(/\s+/gu, ' ').trim());
              keysToSynchronize.push(writeProfile.titlePropertyKey);
            }
            continue;
          }
          if (CANONICAL_ENVELOPE_KEYS.has(normalizedKey)) continue;
          if (value === undefined || value === null) deleteValueCaseInsensitive(canonical, key);
          else setValueCaseInsensitive(canonical, key, value);
          keysToSynchronize.push(key);
        }
        setValueCaseInsensitive(canonical, 'modifiedDate', new Date().toISOString());
        if (writeProfile.modifiedPropertyKey) keysToSynchronize.push(writeProfile.modifiedPropertyKey);

        const desired = applyEnvelopeToRawFrontmatter(
          frontmatter,
          canonical,
          writeProfile,
          matchSet.matchedProfiles,
          matchSet.recognizedIdentityTagProfiles,
        );
        if (!desired) return;
        const currentWriteKeys = new Set(storageKeys(writeProfile).map((key) => key.toLocaleLowerCase()));
        for (const matchedProfile of matchSet.matchedProfiles) {
          for (const legacyKey of storageKeys(matchedProfile)) {
            if (!currentWriteKeys.has(legacyKey.toLocaleLowerCase())) keysToSynchronize.push(legacyKey);
          }
        }
        for (const requiredKey of [writeProfile.kindPropertyKey, writeProfile.titlePropertyKey]) {
          const currentKey = findKeyCaseInsensitive(frontmatter, requiredKey);
          const desiredKey = findKeyCaseInsensitive(desired, requiredKey);
          if (!currentKey || !desiredKey || String(frontmatter[currentKey] ?? '').trim() !== String(desired[desiredKey] ?? '').trim()) {
            keysToSynchronize.push(requiredKey);
          }
        }
        if (writeProfile.createdPropertyKey) {
          const currentCreatedKey = findKeyCaseInsensitive(frontmatter, writeProfile.createdPropertyKey);
          const desiredCreatedKey = findKeyCaseInsensitive(desired, writeProfile.createdPropertyKey);
          if (
            !currentCreatedKey
            || (!stringifyReadableStorageValue(frontmatter[currentCreatedKey]).trim()
              && Boolean(desiredCreatedKey && stringifyReadableStorageValue(desired[desiredCreatedKey]).trim()))
          ) keysToSynchronize.push(writeProfile.createdPropertyKey);
        }
        const currentTagsKey = findKeyCaseInsensitive(frontmatter, 'tags');
        const desiredTagsKey = findKeyCaseInsensitive(desired, 'tags');
        const currentTags = currentTagsKey ? readTagValues(frontmatter[currentTagsKey]) : [];
        const desiredTags = desiredTagsKey ? readTagValues(desired[desiredTagsKey]) : [];
        if (
          currentTags.length !== desiredTags.length
          || currentTags.some((tag, index) => tag !== desiredTags[index])
        ) {
          keysToSynchronize.push('tags');
        }

        let synchronizedKeys = this.uniquePropertyKeys(keysToSynchronize);
        const candidateFrontmatter = { ...frontmatter };
        for (const ownedKey of synchronizedKeys) {
          const desiredKey = findKeyCaseInsensitive(desired, ownedKey);
          if (!desiredKey) {
            deleteValueCaseInsensitive(candidateFrontmatter, ownedKey);
            continue;
          }
          setValueCaseInsensitive(candidateFrontmatter, desiredKey, desired[desiredKey]);
        }
        const candidateMatch = inspectNativeRecordMatchSet(
          candidateFrontmatter,
          readableProfiles,
          writeProfile,
        );
        if (!candidateMatch) return;
        const reconciledCandidate = applyEnvelopeToRawFrontmatter(
          candidateFrontmatter,
          candidateMatch.inspection.frontmatter,
          writeProfile,
          candidateMatch.matchedProfiles,
          candidateMatch.recognizedIdentityTagProfiles,
        );
        if (!reconciledCandidate) return;
        const reconciliationKeys: string[] = [];
        for (const matchedProfile of candidateMatch.matchedProfiles) {
          for (const legacyKey of storageKeys(matchedProfile)) {
            if (!currentWriteKeys.has(legacyKey.toLocaleLowerCase())) reconciliationKeys.push(legacyKey);
          }
        }
        const candidateTagsKey = findKeyCaseInsensitive(candidateFrontmatter, 'tags');
        const reconciledTagsKey = findKeyCaseInsensitive(reconciledCandidate, 'tags');
        const candidateTags = candidateTagsKey ? readTagValues(candidateFrontmatter[candidateTagsKey]) : [];
        const reconciledTags = reconciledTagsKey ? readTagValues(reconciledCandidate[reconciledTagsKey]) : [];
        if (
          candidateTags.length !== reconciledTags.length
          || candidateTags.some((tag, index) => tag !== reconciledTags[index])
        ) reconciliationKeys.push('tags');
        synchronizedKeys = this.uniquePropertyKeys([...synchronizedKeys, ...reconciliationKeys]);
        for (const ownedKey of reconciliationKeys) {
          const reconciledKey = findKeyCaseInsensitive(reconciledCandidate, ownedKey);
          if (!reconciledKey) {
            deleteValueCaseInsensitive(candidateFrontmatter, ownedKey);
            continue;
          }
          setValueCaseInsensitive(candidateFrontmatter, reconciledKey, reconciledCandidate[reconciledKey]);
        }
        const persistedMatch = inspectNativeRecordMatchSet(
          candidateFrontmatter,
          readableProfiles,
          writeProfile,
        );
        if (!persistedMatch) return;
        for (const ownedKey of synchronizedKeys) {
          const candidateKey = findKeyCaseInsensitive(candidateFrontmatter, ownedKey);
          if (!candidateKey) {
            deleteValueCaseInsensitive(frontmatter, ownedKey);
            continue;
          }
          setValueCaseInsensitive(frontmatter, candidateKey, candidateFrontmatter[candidateKey]);
        }
        mutationAccepted = true;
        persistedFrontmatter = candidateFrontmatter;
        nextEnvelope = persistedMatch.inspection.frontmatter;
      }, cause, {
        emitEvents: false,
        updateEntityIndex: false,
      });
    if (!mutationAccepted) return null;
    if (!changed || !nextEnvelope || !persistedFrontmatter) return this.resolve(record.file);
    this.indexFile(record.file, persistedFrontmatter);
    this.plugin.entityIndexService?.upsertFile(record.file, nextEnvelope);
    this.notify([record.file.path], cause, 'native-record-update');
    return this.toHandle(record.file, nextEnvelope);
  }

  archive(
    reference: NativeRecordReference,
    cause: FilePropertiesMutationCause = { kind: 'user' },
  ): Promise<TpsNativeRecordHandle | null> {
    return this.update(reference, {
      archived: true,
      archivedDate: new Date().toISOString(),
    }, cause);
  }

  rememberCurrentStorageProfile(): void {
    const current = this.getConfiguredStorageProfile();
    const aliases = Array.isArray(this.plugin.settings.nativeRecordStorageAliases)
      ? this.plugin.settings.nativeRecordStorageAliases
      : [];
    this.plugin.settings.nativeRecordStorageAliases = prioritizeReadableStorageAliases(
      [current, ...aliases],
    );
  }

  async migrateStorageProfile(): Promise<TpsNativeRecordStorageMigrationResult> {
    this.assertEnabled();
    this.assertValidStorageProfile();
    this.rebuildIndex();
    const records = [...new Set([
      ...this.recordsByPath.keys(),
      ...this.blockedIdentityEvidencePaths,
    ])].sort((left, right) => left.localeCompare(right));
    const result: TpsNativeRecordStorageMigrationResult = {
      inspected: records.length,
      updated: 0,
      skipped: 0,
      failed: 0,
    };
    const profile = this.getStorageProfile();
    const readableProfiles = this.getReadableStorageProfiles();
    for (const path of records) {
      if (this.blockedIdentityEvidencePaths.has(path)) {
        result.failed += 1;
        logger.flow('NativeRecords', 'storage-profile:migrate-blocked', {
          path,
          reason: 'invalid-or-ambiguous-identity-evidence',
        });
        continue;
      }
      const indexedRecord = this.recordsByPath.get(path);
      if (!indexedRecord || !this.hasUniquePathOwnership(indexedRecord.tpsId, path)) {
        result.failed += 1;
        logger.flow('NativeRecords', 'storage-profile:migrate-blocked', {
          path,
          reason: 'non-unique-stable-id',
        });
        continue;
      }
      const file = this.plugin.app.vault.getFileByPath(path);
      if (!(file instanceof TFile)) {
        result.failed += 1;
        continue;
      }
      const state: { outcome: 'updated' | 'skipped' | 'failed' } = { outcome: 'failed' };
      let persisted: Record<string, unknown> | null = null;
      try {
        await this.plugin.app.vault.process(file, (content) => {
          const parsed = parseNativeRecordDocument(content);
          const matchSet = parsed
            ? inspectNativeRecordMatchSet(parsed.frontmatter, readableProfiles, profile)
            : null;
          const inspection = matchSet?.inspection;
          if (!parsed || !matchSet || !inspection) return content;
          this.rebuildIndex();
          if (!this.recordsByPath.has(path)) this.indexFile(file, parsed.frontmatter);
          if (!this.hasUniquePathOwnership(inspection.id, path)) return content;
          const nextFrontmatter = applyEnvelopeToRawFrontmatter(
            parsed.frontmatter,
            inspection.frontmatter,
            profile,
            matchSet.matchedProfiles,
            matchSet.recognizedIdentityTagProfiles,
          );
          if (!nextFrontmatter) return content;
          parsed.frontmatter = nextFrontmatter;
          const next = serializeNativeRecordDocument(parsed);
          persisted = parsed.frontmatter;
          state.outcome = next === content ? 'skipped' : 'updated';
          return next;
        });
      } catch (error) {
        logger.flowError('NativeRecords', 'storage-profile:migrate-failed', error, { path });
      }
      result[state.outcome] += 1;
      if (persisted) {
        this.indexFile(file, persisted);
        const inspection = this.inspect(persisted);
        if (inspection) this.plugin.entityIndexService?.upsertFile(file, inspection.frontmatter);
      }
      if (state.outcome === 'updated') {
        this.notify([path], { kind: 'user', surface: 'native-record-storage-migration' }, 'native-record-storage-migration');
      }
    }
    if (result.failed === 0) {
      this.plugin.settings.nativeRecordStorageAliases = this.getStorageConfiguration().readAliases;
      await this.plugin.saveSettings();
    }
    this.rebuildIndex();
    logger.flow('NativeRecords', 'storage-profile:migrate-done', { ...result });
    return result;
  }

  async normalizeTaskRecordIdentities(): Promise<{ inspected: number; updated: number; skipped: number }> {
    const records = [...this.recordsByPath.entries()]
      .filter(([, frontmatter]) => frontmatter.kind === 'task')
      .sort(([left], [right]) => left.localeCompare(right));
    let updated = 0;
    let skipped = 0;
    for (const [path, frontmatter] of records) {
      if (!Object.prototype.hasOwnProperty.call(frontmatter, 'sourceTaskId')) continue;
      const legacyId = String(frontmatter.sourceTaskId || '').trim();
      if (legacyId && legacyId !== frontmatter.tpsId) {
        skipped += 1;
        continue;
      }
      const result = await this.update(path, { sourceTaskId: null }, {
        kind: 'user', surface: 'native-task-identity-normalization',
      });
      if (result) updated += 1;
      else skipped += 1;
    }
    return { inspected: records.length, updated, skipped };
  }

  async promoteTask(
    reference: GcmTaskRef,
    cause: FilePropertiesMutationCause = { kind: 'user', surface: 'task-record-promotion' },
  ): Promise<TpsTaskPromotionResult> {
    if (!this.isEnabled()) {
      return { ok: false, changed: false, record: null, sourcePath: reference.path, sourceLine: -1, error: 'Native record mode is not enabled.' };
    }
    const task = await this.plugin.taskApiService.get(reference);
    if (!task) {
      return { ok: false, changed: false, record: null, sourcePath: reference.path, sourceLine: -1, error: 'Task line could not be resolved.' };
    }
    const recordProperties = this.buildTaskRecordProperties(task);
    let record = task.stableId ? await this.resolve(task.stableId) : null;
    let created = false;
    try {
      if (!record) {
        record = await this.create('task', recordProperties, {
          id: task.stableId || undefined,
          cause,
        });
        created = true;
      } else if (record.kind !== 'task') {
        return { ok: false, changed: false, record: null, sourcePath: task.path, sourceLine: task.lineNumber, error: `Existing record ${record.id} is not a task.` };
      } else {
        const priorSourcePath = String(record.frontmatter.sourcePath || '').trim();
        const priorSourceTaskId = String(record.frontmatter.sourceTaskId || '').trim();
        if (
          (priorSourcePath && priorSourcePath !== task.path)
          || (priorSourceTaskId && task.stableId && priorSourceTaskId !== task.stableId)
        ) {
          return {
            ok: false,
            changed: false,
            record: null,
            sourcePath: task.path,
            sourceLine: task.lineNumber,
            error: `Tracked task identity ${record.id} already belongs to a different source task.`,
          };
        }
      }

      const sourceFile = this.plugin.app.vault.getFileByPath(task.path);
      if (!(sourceFile instanceof TFile)) throw new Error('Task source file disappeared during promotion.');
      const replaced = await this.replaceTaskWithRecordLink(sourceFile, task, record.file);
      if (!replaced) {
        if (created) {
          record = await this.update(record.file, { promotionState: 'unlinked' }, cause) || record;
        }
        return {
          ok: false,
          changed: created,
          record,
          sourcePath: task.path,
          sourceLine: task.lineNumber,
          error: 'The task changed before its stable record link could be written. The new record was preserved for recovery.',
        };
      }
      if (record.frontmatter.promotionState === 'unlinked') {
        record = await this.update(record.file, { promotionState: null }, cause) || record;
      }
      this.notify([task.path, record.path], cause, 'task-record-promote');
      logger.flow('NativeRecords', 'task-promote:done', {
        sourcePath: task.path,
        sourceLine: task.lineNumber,
        recordPath: record.path,
        created,
      });
      return {
        ok: true,
        changed: true,
        record,
        sourcePath: task.path,
        sourceLine: task.lineNumber,
      };
    } catch (error) {
      logger.flowError('NativeRecords', 'task-promote:failed', error, {
        sourcePath: task.path,
        sourceLine: task.lineNumber,
        recordPath: record?.path || '',
      });
      return {
        ok: false,
        changed: created,
        record,
        sourcePath: task.path,
        sourceLine: task.lineNumber,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildTaskRecordProperties(task: GcmTaskRecord): Record<string, unknown> {
    const properties: Record<string, unknown> = {
      title: task.title,
      status: task.status || 'todo',
      tags: [...task.tags],
      sourcePath: task.path,
      sourceLine: task.line,
    };
    for (const key of SHARED_TASK_FIELDS) {
      const sourceKey = key === 'recurrenceRule' && !task.fields.recurrenceRule ? 'recurrence' : key;
      const raw = task.fields[sourceKey];
      if (raw == null || String(raw).trim() === '') continue;
      if (key === 'timeEstimate') {
        const numeric = Number(raw);
        properties[key] = Number.isFinite(numeric) ? numeric : raw;
      } else if (key === 'parents') {
        properties[key] = parseStringListInput(raw);
      } else {
        properties[key] = raw;
      }
    }
    return properties;
  }

  private async replaceTaskWithRecordLink(sourceFile: TFile, task: GcmTaskRecord, recordFile: TFile): Promise<boolean> {
    if (this.plugin.app.vault.getFileByPath(sourceFile.path) !== sourceFile) return false;
    let replaced = false;
    await this.plugin.app.vault.process(sourceFile, (content) => {
      const parts = splitContent(content);
      let index = task.lineNumber;
      if (parts.lines[index] !== task.rawLine) {
        const matches = parts.lines
          .map((line, candidate) => line === task.rawLine ? candidate : -1)
          .filter((candidate) => candidate >= 0);
        if (matches.length !== 1) return content;
        [index] = matches;
      }
      const parsed = parseTaskLine(parts.lines[index]);
      if (!parsed) return content;
      const link = this.plugin.app.fileManager.generateMarkdownLink(
        recordFile,
        sourceFile.path,
        undefined,
        task.title,
      );
      parts.lines[index] = `${parsed.prefix}${link}`;
      replaced = true;
      return joinContent(parts.lines, parts.newline, parts.endsWithNewline);
    });
    return replaced;
  }

  private copyUserProperties(properties: Record<string, unknown>): Record<string, unknown> {
    const copied: Record<string, unknown> = {};
    const protectedKeys = new Set(
      storageKeys(this.getStorageProfile()).map((key) => key.toLocaleLowerCase()),
    );
    for (const [key, value] of Object.entries(properties || {})) {
      const normalizedKey = key.trim().toLocaleLowerCase();
      if (!key.trim() || CANONICAL_ENVELOPE_KEYS.has(normalizedKey) || protectedKeys.has(normalizedKey)) continue;
      if (normalizedKey === 'tags') {
        const tags = readTagValues(value);
        if (tags.length) copied[key] = tags;
        continue;
      }
      if (value !== undefined) copied[key] = value;
    }
    return copied;
  }

  /**
   * Core Bases creates a new Markdown file beside the Base, then materializes
   * positive property filters into its frontmatter. In the native TPS profile,
   * a task Base also filters by the canonical record folder, so that temporary
   * file would otherwise disappear from the view immediately. Adopt only files
   * observed through this session's Vault create event, and only while they are
   * still empty, unenveloped task drafts.
   */
  private adoptNewTaskDraft(file: TFile): Promise<void> {
    const existing = this.draftAdoptions.get(file);
    if (existing) return existing;
    const operation = this.adoptNewTaskDraftInternal(file)
      .catch((error) => {
        logger.flowError('NativeRecords', 'base-task-draft:adopt-failed', error, {
          path: file.path,
        });
      })
      .finally(() => {
        this.draftAdoptions.delete(file);
      });
    this.draftAdoptions.set(file, operation);
    return operation;
  }

  private async adoptNewTaskDraftInternal(file: TFile): Promise<void> {
    if (!this.isEnabled() || !this.newlyCreatedFiles.has(file)) return;
    if (file.extension.toLocaleLowerCase() !== 'md') return;
    if (this.plugin.app.vault.getFileByPath(file.path) !== file) return;

    const originalPath = file.path;
    const originalContent = await this.plugin.app.vault.cachedRead(file);
    const original = parseNativeRecordDocument(originalContent);
    if (!original || original.body.trim().length > 0) return;
    if (this.hasNativeIdentityMarker(original.frontmatter)) return;
    const profile = this.getStorageProfile();
    if (!profile.kindPropertyKey) return;
    const originalKind = readValueCaseInsensitive(original.frontmatter, profile.kindPropertyKey);
    if (typeof originalKind !== 'string'
      || originalKind.trim().toLocaleLowerCase() !== 'task') return;

    const now = new Date().toISOString();
    const title = String(readValueCaseInsensitive(original.frontmatter, profile.titlePropertyKey) || file.basename)
      .replace(/\s+/gu, ' ')
      .trim() || 'New task';
    const id = this.generateAvailableId('task');
    const canonicalPath = buildNativeRecordPath(this.getRootPath(), 'task', id, this.getLayout());
    await this.ensureParentFolder(canonicalPath);

    let adopted: TpsNativeRecordEnvelope | null = null;
    await this.plugin.app.vault.process(file, (content) => {
      if (content !== originalContent) return content;
      const parsed = parseNativeRecordDocument(content);
      if (!parsed || parsed.body.trim().length > 0) return content;
      if (this.hasNativeIdentityMarker(parsed.frontmatter)) return content;
      const parsedKind = readValueCaseInsensitive(parsed.frontmatter, profile.kindPropertyKey);
      if (typeof parsedKind !== 'string'
        || parsedKind.trim().toLocaleLowerCase() !== 'task') return content;
      const status = String(parsed.frontmatter.status || '').trim();
      const canonical: TpsNativeRecordEnvelope = {
        ...parsed.frontmatter,
        tpsId: id,
        tpsSchemaVersion: TPS_NATIVE_RECORD_SCHEMA_VERSION,
        kind: 'task',
        title,
        createdDate: now,
        modifiedDate: now,
        status: status || 'todo',
      };
      const persistedFrontmatter = applyEnvelopeToRawFrontmatter(
        parsed.frontmatter,
        canonical,
        profile,
        [],
      );
      const inspection = persistedFrontmatter ? this.inspect(persistedFrontmatter) : null;
      if (!persistedFrontmatter || !inspection || inspection.id !== id || inspection.kind !== 'task') {
        return content;
      }
      parsed.frontmatter = persistedFrontmatter;
      adopted = inspection.frontmatter;
      return serializeNativeRecordDocument(parsed);
    });
    if (!adopted) return;
    if (this.plugin.app.vault.getFileByPath(originalPath) !== file) return;

    await this.plugin.app.vault.rename(file, canonicalPath);
    this.newlyCreatedFiles.delete(file);
    const timer = this.draftEligibilityTimers.get(file);
    if (timer != null) globalThis.clearTimeout(timer);
    this.draftEligibilityTimers.delete(file);
    this.indexFile(file);
    this.plugin.entityIndexService?.upsertFile(file, adopted);
    this.notify([originalPath, canonicalPath], { kind: 'user', surface: 'native-base-new-task' }, 'native-base-new-task');
    logger.flow('NativeRecords', 'base-task-draft:adopted', {
      originalPath,
      canonicalPath,
      recordId: id,
    });
  }

  private async readHandle(file: TFile): Promise<TpsNativeRecordHandle | null> {
    const cached = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    const cachedInspection = this.inspect(cached);
    if (cachedInspection) return this.toHandle(file, cachedInspection.frontmatter);
    try {
      const parsed = parseNativeRecordDocument(await this.plugin.app.vault.cachedRead(file));
      const inspection = parsed ? this.inspect(parsed.frontmatter) : null;
      if (!inspection) return null;
      this.indexFile(file, parsed.frontmatter);
      return this.toHandle(file, inspection.frontmatter);
    } catch {
      return null;
    }
  }

  private toHandle(file: TFile, frontmatter: TpsNativeRecordEnvelope): TpsNativeRecordHandle {
    return {
      file,
      path: file.path,
      id: frontmatter.tpsId,
      kind: frontmatter.kind,
      frontmatter: { ...frontmatter },
    };
  }

  private rebuildIndex(): void {
    const vault = this.plugin.app.vault as typeof this.plugin.app.vault & {
      getMarkdownFiles?: () => TFile[];
    };
    if (typeof vault.getMarkdownFiles !== 'function') return;
    const markdownFiles = vault.getMarkdownFiles();
    this.idsByPath.clear();
    this.pathsById.clear();
    this.recordsByPath.clear();
    this.blockedIdentityEvidencePaths.clear();
    this.blockedPathsById.clear();
    this.assetPathsBySourcePath.clear();
    for (const file of markdownFiles) this.indexFile(file);
  }

  private indexFile(file: TFile, frontmatter?: Record<string, unknown> | null): void {
    this.removePath(file.path);
    const resolved = frontmatter ?? this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (resolved) {
      const readableProfiles = this.getReadableStorageProfiles();
      const applicableProfiles = selectApplicableReadableProfiles(
        resolved,
        readableProfiles,
        this.getStorageProfile(),
      );
      const recoverableIds = new Set<string>();
      for (const profile of applicableProfiles) {
        const evidence = inspectWithProfile(resolved, profile);
        if (evidence) recoverableIds.add(this.idKey(evidence.id));
        if (profile.identityMode === 'property') {
          const propertyId = stringifyReadableStorageValue(
            readValueCaseInsensitive(resolved, profile.identityPropertyKey),
          ).trim();
          if (propertyId) recoverableIds.add(this.idKey(propertyId));
          continue;
        }
        for (const tag of readTagValues(readValueCaseInsensitive(resolved, 'tags'))) {
          const parsedIdentity = parseLegacyIdentityTagEvidence(tag, profile.identityTagPrefix);
          for (const candidate of parsedIdentity?.idCandidates || []) {
            recoverableIds.add(this.idKey(candidate));
          }
        }
      }
      const combinedMatch = inspectNativeRecordMatchSet(
        resolved,
        readableProfiles,
        this.getStorageProfile(),
      );
      if (
        hasInvalidReadableIdentityEvidence(resolved, applicableProfiles, this.getStorageProfile())
        || (recoverableIds.size > 0 && !combinedMatch)
      ) {
        this.blockedIdentityEvidencePaths.add(file.path);
        for (const id of recoverableIds) {
          const paths = this.blockedPathsById.get(id) || new Set<string>();
          paths.add(file.path);
          this.blockedPathsById.set(id, paths);
        }
        return;
      }
    }
    const inspection = this.inspect(resolved);
    if (!inspection) return;
    const resolvedEnvelope = inspection.frontmatter;
    const id = this.idKey(resolvedEnvelope.tpsId);
    this.idsByPath.set(file.path, id);
    this.recordsByPath.set(file.path, { ...resolvedEnvelope });
    const paths = this.pathsById.get(id) || new Set<string>();
    paths.add(file.path);
    this.pathsById.set(id, paths);
    if (resolvedEnvelope.kind === 'asset') {
      const sourcePath = normalizePath(String(resolvedEnvelope.sourcePath || '').trim());
      if (sourcePath) {
        const assetPaths = this.assetPathsBySourcePath.get(sourcePath) || new Set<string>();
        assetPaths.add(file.path);
        this.assetPathsBySourcePath.set(sourcePath, assetPaths);
      }
    }
  }

  private removePath(path: string): void {
    const prior = this.recordsByPath.get(path);
    this.recordsByPath.delete(path);
    this.blockedIdentityEvidencePaths.delete(path);
    for (const [id, paths] of this.blockedPathsById) {
      paths.delete(path);
      if (paths.size === 0) this.blockedPathsById.delete(id);
    }
    if (prior?.kind === 'asset') {
      const sourcePath = normalizePath(String(prior.sourcePath || '').trim());
      const assetPaths = this.assetPathsBySourcePath.get(sourcePath);
      assetPaths?.delete(path);
      if (!assetPaths || assetPaths.size === 0) this.assetPathsBySourcePath.delete(sourcePath);
    }
    const id = this.idsByPath.get(path);
    if (!id) return;
    this.idsByPath.delete(path);
    const paths = this.pathsById.get(id);
    paths?.delete(path);
    if (!paths || paths.size === 0) this.pathsById.delete(id);
  }

  private async handleRecordRename(file: unknown, oldPath: string): Promise<void> {
    const prior = this.recordsByPath.get(oldPath);
    this.removePath(oldPath);
    if (!(file instanceof TFile)) return;

    const cached = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    let envelope = this.inspect(cached)?.frontmatter
      || (isNativeRecordEnvelope(prior) ? prior : null);
    if (!envelope) {
      try {
        const parsed = parseNativeRecordDocument(await this.plugin.app.vault.cachedRead(file));
        const inspection = parsed ? this.inspect(parsed.frontmatter) : null;
        if (inspection) envelope = inspection.frontmatter;
      } catch {
        // A rename can race MetadataCache. If the authoritative read also fails,
        // leave the file untouched and let the next metadata event index it.
      }
    }
    if (!envelope) {
      this.indexFile(file);
      return;
    }

    this.indexFile(file, envelope);
    logger.flow('NativeRecords', 'path:changed', {
      recordId: envelope.tpsId,
      recordKind: envelope.kind,
      oldPath,
      path: file.path,
    });
  }

  private availableRecordPath(
    kind: TpsNativeRecordKind,
    id: string,
    fileName?: string,
    current?: TFile,
  ): string {
    const preferred = buildNativeRecordPath(this.getRootPath(), kind, id, this.getLayout(), fileName);
    const occupied = this.plugin.app.vault.getAbstractFileByPath(preferred);
    if (!occupied || occupied === current) return preferred;
    if (!fileName) throw new Error(`TPS native record path already exists: ${preferred}`);
    const dot = preferred.toLocaleLowerCase().endsWith('.md') ? preferred.length - 3 : preferred.length;
    const stem = preferred.slice(0, dot);
    const extension = preferred.slice(dot);
    for (let suffix = 2; suffix <= 999; suffix += 1) {
      const candidate = `${stem} (${suffix})${extension}`;
      const collision = this.plugin.app.vault.getAbstractFileByPath(candidate);
      if (!collision || collision === current) return candidate;
    }
    throw new Error(`Unable to allocate a unique TPS native record filename for ${preferred}.`);
  }

  private idKey(id: string): string {
    return String(id || '').trim().toLocaleLowerCase();
  }

  private uniquePropertyKeys(keys: string[]): string[] {
    const seen = new Set<string>();
    return keys.filter((rawKey) => {
      const key = String(rawKey || '').trim();
      const folded = key.toLocaleLowerCase();
      if (!key || seen.has(folded)) return false;
      seen.add(folded);
      return true;
    });
  }

  private hasUniquePathOwnership(id: string, path: string): boolean {
    const key = this.idKey(id);
    const paths = this.pathsById.get(key);
    return paths?.size === 1 && paths.has(path) && !this.blockedPathsById.has(key);
  }

  private hasNativeIdentityMarker(frontmatter: Record<string, unknown>): boolean {
    if (this.inspect(frontmatter)) return true;
    for (const profile of this.getReadableStorageProfiles()) {
      if (profile.identityMode === 'property') {
        if (propertyProfileUsesTags(profile)) {
          if (inspectWithProfile(frontmatter, profile)) return true;
          continue;
        }
        if (findKeyCaseInsensitive(frontmatter, profile.identityPropertyKey)) return true;
        if (findKeyCaseInsensitive(frontmatter, profile.schemaPropertyKey)) return true;
      } else if (readTagValues(readValueCaseInsensitive(frontmatter, 'tags')).some((tag) => (
        tag.toLocaleLowerCase().startsWith(
          `${profile.identityTagPrefix.toLocaleLowerCase()}/v${TPS_NATIVE_RECORD_SCHEMA_VERSION}/`,
        )
      ))) {
        return true;
      }
    }
    return false;
  }

  private generateId(kind: TpsNativeRecordKind): string {
    const prefix = RECORD_FOLDER_BY_KIND[kind].replace(/-entries$|-sessions$|-exercises$|s$/gu, '');
    const uuid = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    return `${prefix}-${uuid}`;
  }

  private generateAvailableId(kind: TpsNativeRecordKind): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = this.generateId(kind);
      const path = buildNativeRecordPath(this.getRootPath(), kind, id, this.getLayout());
      if (!this.plugin.app.vault.getAbstractFileByPath(path) && !this.pathsById.has(this.idKey(id))) return id;
    }
    throw new Error(`Unable to allocate a unique TPS native ${kind} record ID.`);
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const segments = normalizePath(path).split('/').slice(0, -1);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.plugin.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`Cannot create TPS record folder because a file exists at ${current}.`);
      await this.plugin.app.vault.createFolder(current);
    }
  }

  private notify(paths: string[], cause: FilePropertiesMutationCause | undefined, source: string): void {
    const sourcePluginId = String(cause?.sourcePluginId || this.plugin.manifest.id);
    this.plugin.eventService.emitFilesUpdated(paths, { sourcePluginId });
    if (cause?.kind !== 'automation') {
      this.plugin.eventService.emitExplicitAction(paths, {
        sourcePluginId,
        source: String(cause?.surface || source),
      });
    }
  }

  private assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new Error('TPS native record creation requires the native-records data architecture mode.');
    }
  }

  private assertValidStorageProfile(): void {
    const errors = validateNativeRecordStorageProfile(this.getStorageProfile());
    if (errors.length) throw new Error(`Invalid native record storage settings: ${errors.join(' ')}`);
  }

  private assertAssetSource(source: TFile): void {
    this.assertEnabled();
    if (!(source instanceof TFile)) throw new Error('Asset record source must be a vault file.');
    if (source.extension.toLocaleLowerCase() === 'md') {
      throw new Error('Asset records are only created for non-Markdown source files.');
    }
    if (this.plugin.app.vault.getFileByPath(source.path) !== source) {
      throw new Error('Asset record source is no longer the live file at that path.');
    }
  }
}
