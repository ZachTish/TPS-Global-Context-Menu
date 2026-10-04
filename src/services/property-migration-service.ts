import { MANAGED_NOTE_FIELDS, managedNoteFieldKey } from '../utils/managed-note-fields';
import { PLUGIN_MAPPING_FIELDS, pluginMappingPatches, type PluginSettingsPatch } from '../utils/plugin-mapping-references';
import { Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { PropertyMigrationModal } from '../modals/property-migration-modal';
import { migrateNoteProperties, PropertyMigration, SettingsPatch, settingsPatches, updateMigrationReferences, validateMigration, validateMigrationSettings } from '../utils/property-migration';
import { migrateNoteClassification, migrateNoteDiscriminator, validateKindClassificationMigration, type KindClassificationMigration, type KindDiscriminatorMigration } from '../utils/kind-classification-migration';
import { kindClassification, kindDiscriminator, kindReadClassifications, normalizeKindClassification, type KindClassification, type KindDiscriminator, type KindMappings } from '../utils/kind-classification';
import { planKindBaseReferences, planKindReferenceSettings, planPropertyKeyBaseReferences, planPropertyKeyNavigatorReferences } from '../utils/kind-reference-migration';
import * as logger from '../logger';

interface NoteChange { path: string; before: string; after: string }
interface MigrationPlan { notes: NoteChange[]; blocked: string[]; financeSettings?: string }
interface RecoveryRecord { version: 1; notes: NoteChange[]; patches: SettingsPatch[]; plugins?: PluginSettingsPatch[] }
type MigrationRequest = PropertyMigration | KindClassificationMigration | KindDiscriminatorMigration;
const financeRecordKinds = new Set(['account', 'finance-transaction', 'investment-transaction', 'holding', 'ledger', 'finance-rule', 'finance-budget']);
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value));
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** One explicit transaction at a time. Recovery contains private note snapshots and stays in plugin runtime storage. */
export class PropertyMigrationService {
  active = false;
  private busy = false;
  private disposed = false;
  private cancelScan: (() => void) | null = null;
  private recoveryPending = false;
  private get recoveryPath(): string { return `${this.plugin.manifest.dir}/property-migration-recovery.json`; }
  constructor(private plugin: TPSGlobalContextMenuPlugin) {}
  async initialize(): Promise<void> {
    this.recoveryPending = await this.plugin.app.vault.adapter.exists(this.recoveryPath);
    if (this.recoveryPending) new Notice('A property migration needs recovery. Open GCM → Advanced → Restore interrupted property migration.', 0);
  }
  dispose(): void { this.disposed = true; this.cancelScan?.(); }
  hasRecovery(): boolean { return this.recoveryPending; }
  private kindValuePathChange(change: MigrationRequest): KindClassificationMigration | null {
    if (change.kind !== 'value') return null;
    for (const recordKind of Object.keys(this.plugin.settings.nativeRecordKindPropertyKeys || {})) {
      const primary = kindClassification(this.plugin.settings.nativeRecordKindPropertyKeys, recordKind);
      if (primary && 'kindList' in primary && primary.kindList.key.toLowerCase() === change.key.toLowerCase()
        && primary.kindList.value === change.from) {
        return { kind: 'classification', recordKind, from: primary,
          to: { kindList: { key: primary.kindList.key, value: change.to } } };
      }
    }
    return null;
  }
  private discriminatorValueChange(change: MigrationRequest): KindDiscriminatorMigration | null {
    if (change.kind !== 'value') return null;
    for (const recordKind of Object.keys(this.plugin.settings.nativeRecordKindPropertyKeys || {})) {
      const primary = kindClassification(this.plugin.settings.nativeRecordKindPropertyKeys, recordKind);
      const discriminator = kindDiscriminator(this.plugin.settings.nativeRecordKindPropertyKeys, recordKind);
      if (primary && 'kindList' in primary && discriminator && discriminator.key.toLowerCase() === change.key.toLowerCase()
        && discriminator.value === change.from) {
        return { kind: 'discriminator', recordKind, primary, from: discriminator,
          to: { key: discriminator.key, value: change.to } };
      }
    }
    return null;
  }
  async preview(change: MigrationRequest): Promise<MigrationPlan> {
    const notes: NoteChange[] = [], blocked: string[] = [];
    const files = this.plugin.app.vault.getMarkdownFiles();
    const progress = new Notice(`Scanning note properties: 0 / ${files.length}`, 0);
    let cursor = 0, completed = 0, cancelled = false;
    let cancel!: () => void;
    const cancellation = new Promise<never>((_, reject) => {
      cancel = () => { cancelled = true; reject(new Error('Property scan cancelled. No migration was started.')); };
    });
    this.cancelScan = cancel;
    const cancelButton = progress.containerEl?.createEl('button', { text: 'Cancel scan' });
    cancelButton?.addEventListener('click', cancel);

    const worker = async () => {
      while (!cancelled && cursor < files.length) {
        const file = files[cursor++];
        try {
          const before = await this.plugin.app.vault.read(file);
          if (cancelled) return;
          const after = change.kind === 'classification'
            ? migrateNoteClassification(before, change, this.plugin.settings.nativeRecordKindPropertyKeys)
            : change.kind === 'discriminator'
              ? migrateNoteDiscriminator(before, change, this.plugin.settings.nativeRecordKindPropertyKeys)
              : migrateNoteProperties(before, change);
          if (after !== before) notes.push({ path: file.path, before, after });
        } catch (error) { blocked.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`); }
        completed++;
        if (completed % 100 === 0) progress.setMessage?.(`Scanning note properties: ${completed} / ${files.length}`);
      }
    };
    try { await Promise.race([Promise.all(Array.from({ length: Math.min(8, files.length) }, worker)), cancellation]); }
    finally { this.cancelScan = null; progress.hide?.(); }
    let financeSettings: string | undefined;
    if (change.kind === 'classification') {
      const finance = this.consumer('tps-finances');
      const bases = finance?.api?.classificationBases;
      if (finance && financeRecordKinds.has(change.recordKind)
        && (bases?.version !== 1 || typeof bases.preview !== 'function' || typeof bases.settingsSignature !== 'function')) {
        throw new Error('Update TPS Finances to 1.15.0 or later before changing a Finance record classification.');
      }
      if (bases?.version === 1 && typeof bases.preview === 'function') {
        financeSettings = bases.settingsSignature?.();
        for (const entry of await bases.preview(change)) {
          if (typeof entry.path !== 'string' || !entry.path.endsWith('.base') || typeof entry.before !== 'string' || typeof entry.after !== 'string') throw new Error('Finances returned an invalid generated Base preview.');
          notes.push(entry);
        }
      }
    }
    const baseReferenceChange = this.kindValuePathChange(change) || this.discriminatorValueChange(change) ||
      (change.kind === 'classification' || change.kind === 'discriminator' ? change : null);
    if (baseReferenceChange && (baseReferenceChange.kind === 'discriminator' ||
      ('kindList' in baseReferenceChange.from && 'kindList' in baseReferenceChange.to))) {
      const referenceMappings = change.kind === 'value' && baseReferenceChange.kind === 'classification'
        ? { [baseReferenceChange.recordKind]: this.plugin.settings.nativeRecordKindPropertyKeys[baseReferenceChange.recordKind] }
        : this.plugin.settings.nativeRecordKindPropertyKeys;
      for (const file of this.plugin.app.vault.getFiles?.().filter(file => file.extension === 'base') || []) {
        try {
          const existing = notes.find(note => note.path === file.path);
          const before = existing?.before || await this.plugin.app.vault.read(file);
          const proposed = existing?.after || before;
          const result = planKindBaseReferences(proposed, baseReferenceChange, referenceMappings);
          blocked.push(...result.blocked.map(reason => `${file.path}: ${reason}`));
          if (existing) existing.after = result.after;
          else if (result.after !== before) notes.push({ path: file.path, before, after: result.after });
        } catch (error) { blocked.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    if (change.kind === 'key' && !change.recordKinds) {
      for (const file of this.plugin.app.vault.getFiles?.().filter(file => file.extension === 'base') || []) {
        try {
          const before = await this.plugin.app.vault.read(file);
          const result = planPropertyKeyBaseReferences(before, change.from, change.to);
          blocked.push(...result.blocked.map(reason => `${file.path}: ${reason}`));
          if (result.after !== before) notes.push({ path: file.path, before, after: result.after });
        } catch (error) { blocked.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    notes.sort((a, b) => a.path.localeCompare(b.path));
    blocked.sort();
    return { notes, blocked, financeSettings };
  }
  private consumer(id: string): any { return (this.plugin.app as any).plugins?.plugins?.[id]; }
  async requestPluginKey(pluginId: string, settingKey: string, to: string): Promise<boolean> {
    if (!['tps-controller', 'tps-calendar-base'].includes(pluginId) || !Object.prototype.hasOwnProperty.call(PLUGIN_MAPPING_FIELDS[pluginId], settingKey)) throw new Error('Unsupported property mapping.');
    const owner = this.consumer(pluginId);
    if (!owner?.settings || typeof owner.saveSettings !== 'function') throw new Error('Enable the owning plugin before changing its mapping.');
    const from = owner.settings[settingKey] || PLUGIN_MAPPING_FIELDS[pluginId][settingKey];
    return this.request({ kind: 'key', from, to: to.trim() }, () => {});
  }
  async requestHealthKindKey(to: string): Promise<boolean> {
    const health = this.consumer('tps-health');
    const kinds = Object.values(health?.settings?.nativeRecordKinds || {}) as string[];
    if (!kinds.length) throw new Error('Enable Health before changing its record key.');
    to = to.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(to)) throw new Error('Enter a valid frontmatter key.');
    if (kinds.some(kind => { const mapping = kindClassification(this.plugin.settings.nativeRecordKindPropertyKeys, kind); return mapping && !('key' in mapping); })) throw new Error('These records use a configured classification. Change it in GCM → Rules & fields → Custom fields.');
    const fromKeys = [...new Set(kinds.map(kind => this.plugin.nativeRecordService.getStorageProfile(kind).kindPropertyKey))];
    if (fromKeys.length !== 1) throw new Error('Health records have inconsistent key mappings. Repair these before migrating.');
    if (fromKeys[0] === to) return false;
    const profile = this.plugin.nativeRecordService.getStorageProfile(kinds[0]);
    if (['identityPropertyKey', 'schemaPropertyKey', 'titlePropertyKey', 'createdPropertyKey', 'modifiedPropertyKey'].some(field => String((profile as any)[field] || '').toLowerCase() === to.toLowerCase())) throw new Error('This key belongs to the shared record envelope.');
    if (Object.values(health.settings.nativeRecordProperties || {}).some(key => String(key).toLowerCase() === to.toLowerCase())
      || [health.settings.workoutStartPropertyKey, health.settings.workoutIntervalPropertyKey].some(key => String(key).toLowerCase() === to.toLowerCase())) throw new Error('Another Health field already uses this key.');
    return this.request({ kind: 'key', from: fromKeys[0], to, recordKinds: kinds }, settings => {
      settings.nativeRecordKindPropertyKeys = { ...settings.nativeRecordKindPropertyKeys, ...Object.fromEntries(kinds.map(kind => {
        const previous = settings.nativeRecordKindPropertyKeys?.[kind];
        if (previous && typeof previous === 'object' && 'primary' in previous && 'key' in previous.primary) {
          return [kind, { ...previous, primary: { ...previous.primary, key: to } }];
        }
        return [kind, previous && typeof previous === 'object' && 'key' in previous ? { ...previous, key: to } : to];
      })) };
    });
  }
  private assertConsumers(plans: PluginSettingsPatch[]): void {
    for (const plan of plans) {
      const owner = this.consumer(plan.pluginId);
      if (!owner?.settings || plan.patches.some(patch => !equal(owner.settings[patch.key], patch.before))) throw new Error(`${plan.pluginId} settings changed. Review the migration again.`);
    }
  }
  private async saveConsumers(plans: PluginSettingsPatch[], restore = false): Promise<void> {
    for (const plan of plans) {
      const owner = this.consumer(plan.pluginId);
      if (!owner?.settings) throw new Error(`Enable ${plan.pluginId} to finish recovery.`);
      for (const patch of plan.patches) {
        if (restore && !equal(owner.settings[patch.key], patch.before) && !equal(owner.settings[patch.key], patch.after)) throw new Error(`${plan.pluginId} settings changed since migration.`);
        const value = patch[restore ? 'before' : 'after'];
        if (value === undefined) delete owner.settings[patch.key]; else owner.settings[patch.key] = clone(value);
      }
      if (plan.pluginId === 'tps-notebook-navigator') {
        if (typeof owner.saveSettingsAndUpdate !== 'function') throw new Error('Update TPS Notebook Navigator before migrating kind references.');
        await owner.saveSettingsAndUpdate();
      } else await owner.saveSettings();
      owner.nativeRecordService?.refreshConfiguration?.();
    }
  }
  async requestClassification(change: KindClassificationMigration): Promise<boolean> {
    validateKindClassificationMigration(change, this.plugin.settings.nativeRecordKindPropertyKeys);
    const priorMappings = this.plugin.settings.nativeRecordKindPropertyKeys;
    return this.request(change, settings => { settings.nativeRecordKindPropertyKeys[change.recordKind] = this.mappingWithPriorAlias(change, priorMappings); });
  }

  private mappingWithPriorAlias(change: KindClassificationMigration, mappings: KindMappings) {
    const previous = kindReadClassifications(mappings, change.recordKind);
    const primary = normalizeKindClassification(change.to, change.recordKind);
    const aliases = previous.filter(definition => JSON.stringify(definition).toLowerCase() !== JSON.stringify(primary).toLowerCase());
    const entry = mappings[change.recordKind];
    const writeDisabled = Boolean(entry && typeof entry === 'object' && 'primary' in entry && entry.writeDisabled);
    const discriminator = 'kindList' in primary ? kindDiscriminator(mappings, change.recordKind) : null;
    const next = { primary, aliases, ...(discriminator ? { discriminator } : {}), ...(writeDisabled ? { writeDisabled: true } : {}) };
    if (discriminator) kindDiscriminator({ ...mappings, [change.recordKind]: next }, change.recordKind);
    return next;
  }

  private assertUniqueClassifications(mappings: KindMappings): void {
    const used = new Map<string, string>();
    const sharedLists = new Map<string, Map<string, string>>();
    for (const kind of Object.keys(mappings)) for (const definition of kindReadClassifications(mappings, kind)) {
      const key = JSON.stringify(definition).toLowerCase();
      const prior = used.get(key);
      if (prior && prior !== kind && !('kindList' in definition)) throw new Error(`This classification is already assigned to ${prior}.`);
      used.set(key, kind);
      if (!('kindList' in definition) || JSON.stringify(definition).toLowerCase()
        !== JSON.stringify(kindClassification(mappings, kind)).toLowerCase()) continue;
      const discriminator = kindDiscriminator(mappings, kind);
      if (!discriminator) continue;
      const listKey = `${definition.kindList.key.toLowerCase()}\u0000${definition.kindList.value.toLowerCase()}`;
      const identities = sharedLists.get(listKey) || new Map<string, string>();
      const identity = `${discriminator.key.toLowerCase()}\u0000${discriminator.value}`;
      const priorKind = identities.get(identity);
      if (priorKind && priorKind !== kind) {
        throw new Error(`Shared kind-list path needs distinct identity values; check ${priorKind} and ${kind}.`);
      }
      identities.set(identity, kind);
      sharedLists.set(listKey, identities);
    }
  }

  /** Switch only the writer; old notes remain visible through explicit read aliases. */
  async configureClassificationWriter(change: KindClassificationMigration): Promise<void> {
    if (this.busy || this.recoveryPending || this.disposed) throw new Error('Finish the current migration before changing record classifications.');
    validateKindClassificationMigration(change, this.plugin.settings.nativeRecordKindPropertyKeys);
    const before = this.plugin.settings.nativeRecordKindPropertyKeys;
    const next = { ...before, [change.recordKind]: this.mappingWithPriorAlias(change, before) };
    this.assertUniqueClassifications(next);
    this.plugin.settings.nativeRecordKindPropertyKeys = next;
    try { await this.plugin.saveSettings(); }
    catch (error) { this.plugin.settings.nativeRecordKindPropertyKeys = before; throw error; }
    this.plugin.nativeRecordService.refreshConfiguration();
  }

  async configureClassificationAliases(recordKind: string, aliases: KindClassification[], expectedPrimary: KindClassification): Promise<void> {
    if (this.busy || this.recoveryPending || this.disposed) throw new Error('Finish the current migration before changing record classifications.');
    const before = this.plugin.settings.nativeRecordKindPropertyKeys;
    const primary = kindClassification(before, recordKind);
    if (!primary || JSON.stringify(primary) !== JSON.stringify(expectedPrimary)) throw new Error('The record mapping changed. Reopen settings.');
    const normalized = aliases.map(alias => normalizeKindClassification(alias, recordKind));
    const entry = before[recordKind];
    const writeDisabled = Boolean(entry && typeof entry === 'object' && 'primary' in entry && entry.writeDisabled);
    const discriminator = kindDiscriminator(before, recordKind);
    const next: KindMappings = { ...before, [recordKind]: { primary, aliases: normalized,
      ...(discriminator ? { discriminator } : {}), ...(writeDisabled ? { writeDisabled: true } : {}) } };
    this.assertUniqueClassifications(next);
    this.plugin.settings.nativeRecordKindPropertyKeys = next;
    try { await this.plugin.saveSettings(); }
    catch (error) { this.plugin.settings.nativeRecordKindPropertyKeys = before; throw error; }
    this.plugin.nativeRecordService.refreshConfiguration();
  }

  async configureNewClassification(recordKind: string, definition: KindClassification): Promise<void> {
    if (this.busy || this.recoveryPending || this.disposed) throw new Error('Finish the current migration before changing record classifications.');
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(recordKind)) throw new Error('Choose a lowercase record type name with letters, numbers and hyphens.');
    const before = this.plugin.settings.nativeRecordKindPropertyKeys;
    if (Object.prototype.hasOwnProperty.call(before, recordKind)) throw new Error('That record type already has a mapping.');
    const next = { ...before, [recordKind]: normalizeKindClassification(definition, recordKind) };
    this.assertUniqueClassifications(next);
    this.plugin.settings.nativeRecordKindPropertyKeys = next;
    try { await this.plugin.saveSettings(); }
    catch (error) { this.plugin.settings.nativeRecordKindPropertyKeys = before; throw error; }
    this.plugin.nativeRecordService.refreshConfiguration();
  }

  /** Remove only the selected mapping. Notes are not edited or scanned. */
  async removeClassification(recordKind: string, expectedPrimary: KindClassification): Promise<void> {
    if (this.busy || this.recoveryPending || this.disposed) throw new Error('Finish the current migration before changing record classifications.');
    const before = this.plugin.settings.nativeRecordKindPropertyKeys;
    if (JSON.stringify(kindClassification(before, recordKind)) !== JSON.stringify(expectedPrimary)) {
      throw new Error('The record mapping changed. Reopen settings.');
    }
    const next = { ...before };
    delete next[recordKind];
    this.plugin.settings.nativeRecordKindPropertyKeys = next;
    try { await this.plugin.saveSettings(); }
    catch (error) { this.plugin.settings.nativeRecordKindPropertyKeys = before; throw error; }
    this.plugin.nativeRecordService.refreshConfiguration();
  }

  async configureClassificationWriterEnabled(recordKind: string, enabled: boolean, expectedPrimary: KindClassification): Promise<void> {
    if (this.busy || this.recoveryPending || this.disposed) throw new Error('Finish the current migration before changing record classifications.');
    const before = this.plugin.settings.nativeRecordKindPropertyKeys;
    if (JSON.stringify(kindClassification(before, recordKind)) !== JSON.stringify(expectedPrimary)) throw new Error('The record mapping changed. Reopen settings.');
    const discriminator = kindDiscriminator(before, recordKind);
    const next = { ...before, [recordKind]: {
      primary: expectedPrimary,
      aliases: kindReadClassifications(before, recordKind).slice(1),
      ...(discriminator ? { discriminator } : {}),
      ...(!enabled ? { writeDisabled: true } : {}),
    } };
    this.plugin.settings.nativeRecordKindPropertyKeys = next;
    try { await this.plugin.saveSettings(); }
    catch (error) { this.plugin.settings.nativeRecordKindPropertyKeys = before; throw error; }
    this.plugin.nativeRecordService.refreshConfiguration();
  }

  async configureClassificationDiscriminator(
    recordKind: string,
    discriminator: KindDiscriminator | null,
    expectedPrimary: KindClassification,
  ): Promise<boolean> {
    if (this.busy || this.recoveryPending || this.disposed) throw new Error('Finish the current migration before changing record classifications.');
    const before = this.plugin.settings.nativeRecordKindPropertyKeys;
    const primary = kindClassification(before, recordKind);
    if (!primary || JSON.stringify(primary) !== JSON.stringify(expectedPrimary)) throw new Error('The record mapping changed. Reopen settings.');
    if (discriminator && !('kindList' in primary)) throw new Error('An additional identity field requires a kind-list mapping.');
    const entry = before[recordKind];
    const oldDiscriminator = kindDiscriminator(before, recordKind);
    if (equal(oldDiscriminator, discriminator)) return false;
    const writeDisabled = Boolean(entry && typeof entry === 'object' && 'primary' in entry && entry.writeDisabled);
    const next: KindMappings = { ...before, [recordKind]: { primary,
      aliases: kindReadClassifications(before, recordKind).slice(1),
      ...(discriminator ? { discriminator } : {}),
      ...(writeDisabled ? { writeDisabled: true } : {}),
    } };
    if (discriminator) kindDiscriminator(next, recordKind);
    this.assertUniqueClassifications(next);
    if (!discriminator && Object.keys(next).some(kind => kind !== recordKind && kindReadClassifications(next, kind)
      .some(definition => 'kindList' in definition && 'kindList' in primary
        && definition.kindList.key.toLowerCase() === primary.kindList.key.toLowerCase()
        && definition.kindList.value.toLowerCase() === primary.kindList.value.toLowerCase()))) {
      throw new Error('A shared kind-list path needs an identity property for every record type.');
    }
    return this.request({ kind: 'discriminator', recordKind, primary, from: oldDiscriminator, to: discriminator }, settings => {
      settings.nativeRecordKindPropertyKeys = next;
    });
  }
  async request(change: MigrationRequest, configure: (settings: typeof this.plugin.settings) => void): Promise<boolean> {
    if (this.disposed) throw new Error('GCM was reloaded. Reopen its settings before migrating.');
    if (this.busy || this.recoveryPending) throw new Error('Finish or restore the previous property migration first.');
    if (change.kind === 'key' && !change.recordKinds) {
      const from = change.from;
      const field = MANAGED_NOTE_FIELDS.find(field => managedNoteFieldKey(this.plugin.settings, field).toLowerCase() === from.toLowerCase());
      if (field) change = { ...change, previousKeys: [field, ...(this.plugin.settings.managedNoteFieldAliases?.[field] || [])] };
    }
    if (change.kind === 'classification') validateKindClassificationMigration(change, this.plugin.settings.nativeRecordKindPropertyKeys);
    else if (change.kind === 'discriminator') {
      if (!equal(kindClassification(this.plugin.settings.nativeRecordKindPropertyKeys, change.recordKind), change.primary)
        || !equal(kindDiscriminator(this.plugin.settings.nativeRecordKindPropertyKeys, change.recordKind), change.from)) {
        throw new Error('The record mapping changed. Reopen settings.');
      }
    } else { validateMigration(change); validateMigrationSettings(this.plugin.settings, change); }
    this.busy = true;
    try {
      const beforeSettings = clone(this.plugin.settings);
      let afterSettings = clone(beforeSettings);
      const navigator = this.consumer('tps-notebook-navigator');
      const kindValueChange = this.kindValuePathChange(change);
      const discriminatorValueChange = this.discriminatorValueChange(change);
      const dependentChange = kindValueChange || discriminatorValueChange ||
        (change.kind === 'classification' || change.kind === 'discriminator' ? change : null);
      if (change.kind === 'key' || change.kind === 'value') updateMigrationReferences(afterSettings, change);
      else if (change.kind === 'classification' && 'tag' in change.from && 'tag' in change.to) updateMigrationReferences(afterSettings,
        { kind: 'value', key: 'tags', from: change.from.tag, to: change.to.tag });
      const referenceMappings = kindValueChange
        ? { [kindValueChange.recordKind]: this.plugin.settings.nativeRecordKindPropertyKeys[kindValueChange.recordKind] }
        : this.plugin.settings.nativeRecordKindPropertyKeys;
      const kindReferences = dependentChange
        ? planKindReferenceSettings(afterSettings, navigator?.settings || null, dependentChange, referenceMappings) : null;
      const keyReferences = change.kind === 'key' && !change.recordKinds
        ? planPropertyKeyNavigatorReferences(navigator?.settings || null, change.from, change.to) : null;
      if (kindReferences) afterSettings = kindReferences.gcm;
      if ((dependentChange || keyReferences) && !navigator && (this.plugin.app as any).plugins?.manifests?.['tps-notebook-navigator'])
        kindReferences?.blocked.push('TPS Notebook Navigator is installed but disabled; enable it to migrate its kind references.');
      if (keyReferences && !navigator && (this.plugin.app as any).plugins?.manifests?.['tps-notebook-navigator'])
        keyReferences.blocked.push('TPS Notebook Navigator is installed but disabled; enable it to migrate property-key references.');
      configure(afterSettings);
      if (change.kind === 'key' || change.kind === 'value') this.assertUniqueClassifications(afterSettings.nativeRecordKindPropertyKeys || {});
      const patches = settingsPatches(beforeSettings, afterSettings);
      const plugins = (change.kind === 'classification' || change.kind === 'discriminator' || (change.kind === 'key' && change.recordKinds) ? [] : Object.keys(PLUGIN_MAPPING_FIELDS)).flatMap(pluginId => {
        const owner = this.consumer(pluginId);
        if (!owner?.settings) return [];
        const patches = pluginMappingPatches(pluginId, owner.settings, change as PropertyMigration);
        return patches.length ? [{ pluginId, patches }] : [];
      });
      if (navigator && kindReferences?.navigator) {
        const navigatorPatches = settingsPatches(navigator.settings, kindReferences.navigator);
        if (navigatorPatches.length) plugins.push({ pluginId: 'tps-notebook-navigator', patches: navigatorPatches });
      }
      if (navigator && keyReferences?.navigator) {
        const navigatorPatches = settingsPatches(navigator.settings, keyReferences.navigator);
        if (navigatorPatches.length) plugins.push({ pluginId: 'tps-notebook-navigator', patches: navigatorPatches });
      }
      const healthKinds = change.kind === 'key' && change.recordKinds ? JSON.stringify(this.consumer('tps-health')?.settings?.nativeRecordKinds) : null;
      const plan = await this.preview(change);
      if (this.disposed) throw new Error('GCM was reloaded. Apply again to review a fresh preview.');
      const scope = change.kind === 'key' && change.recordKinds ? 'Only logged Health entries and workout sessions are included; reusable templates and other record types keep their keys.' : 'Includes archived notes and templates.';
      const name = change.kind === 'classification' ? `Change ${change.recordKind} from ${'tag' in change.from ? 'tag' : 'property'} to ${'tag' in change.to ? 'tag' : 'property'}`
        : change.kind === 'discriminator' ? `Change ${change.recordKind} shared-path identity`
          : change.kind === 'key' ? `Rename property “${change.from}” → “${change.to}”` : `Rename ${change.key} value “${change.from}” → “${change.to}”`;
      const explanation = change.kind === 'classification'
        ? `${plan.notes.length} notes and Bases may change, with ${kindReferences?.changed.length || 0} dependent setting references. ${scope} This converts the exact record classification in frontmatter and updates recognized dependent filters and settings. Ambiguous references block the change. A temporary local recovery copy is kept until completion.`
        : change.kind === 'discriminator'
          ? `${plan.notes.length} notes and Bases may change, with ${kindReferences?.changed.length || 0} dependent setting references. ${scope} This changes the selected record type’s identity field and its recognized dependent rules. Ambiguous references block the change. A temporary local recovery copy is kept until completion.`
        : `${plan.notes.length} notes or Bases may change. ${scope} Exact string values and list items match; note bodies and inline fields are not rewritten. ${kindValueChange ? 'Recognized kind-path filters and dependent Navigator settings update together. ' : ''}${keyReferences ? 'Recognized Base and Navigator property-key references update together. ' : ''}Matching mappings in enabled TPS plugins update together; disabled plugins must be enabled before migrating their fields. ${patches.length} GCM settings groups and ${plugins.length} TPS plugins will update. A temporary local recovery copy is kept until completion.`;
      const confirmed = await PropertyMigrationModal.confirm(this.plugin.app, name,
        explanation,
        [...plan.notes.map(note => note.path), ...(kindReferences?.changed || []), ...(keyReferences?.changed || [])],
        [...plan.blocked, ...(kindReferences?.blocked || []), ...(keyReferences?.blocked || [])]);
      if (!confirmed) return false;
      if (plan.blocked.length || kindReferences?.blocked.length || keyReferences?.blocked.length) throw new Error('Resolve the listed migration conflicts before applying.');
      if (this.disposed) throw new Error('GCM was reloaded. Apply again to review a fresh preview.');
      if (!equal(beforeSettings, this.plugin.settings)) throw new Error('Settings changed during preview. Apply again to review a fresh preview.');
      if (healthKinds && healthKinds !== JSON.stringify(this.consumer('tps-health')?.settings?.nativeRecordKinds)) throw new Error('Health kinds changed. Review the migration again.');
      this.assertConsumers(plugins);
      const fresh = await this.preview(change);
      if (fresh.blocked.length || !equal(plan.notes, fresh.notes)) throw new Error('Notes changed during preview. Apply again to review a fresh preview.');
      if (plan.financeSettings !== fresh.financeSettings) throw new Error('Finances settings changed during preview. Apply again to review a fresh preview.');
      const record: RecoveryRecord = { version: 1, notes: plan.notes, patches, plugins };
      if (this.consumer('tps-controller')?.autoCreateService?.isSyncing) throw new Error('Wait for calendar synchronization to finish, then apply again.');
      if (this.consumer('tps-health')?.settings?.activeWorkoutId || this.consumer('tps-health')?.settings?.activeWorkoutPath) throw new Error('Finish the active workout before migrating shared properties.');
      this.active = true;
      new Notice(`Updating ${plan.notes.length} note properties…`);
      // Write once before the first mutation. The immutable record covers every possible partial write.
      try {
        await this.plugin.app.vault.adapter.write(this.recoveryPath, JSON.stringify(record));
        this.recoveryPending = true;
        // Verify the recovery copy before trusting it for vault-wide changes.
        if (await this.plugin.app.vault.adapter.read(this.recoveryPath) !== JSON.stringify(record)) throw new Error('Could not verify the migration recovery copy.');
      } catch (error) {
        this.recoveryPending = await this.plugin.app.vault.adapter.exists(this.recoveryPath);
        throw error;
      }
      try {
        for (const note of plan.notes) await this.write(note, false);
        for (const note of plan.notes) {
          const file = this.plugin.app.vault.getAbstractFileByPath(note.path);
          if (!(file instanceof TFile) || await this.plugin.app.vault.read(file) !== note.after) throw new Error('A migrated note changed. Restoring the migration.');
        }
        const remaining = await this.preview(change);
        if (remaining.notes.length || remaining.blocked.length) throw new Error('New matching notes appeared during migration. Restoring the migration.');
        if (plan.financeSettings !== remaining.financeSettings) throw new Error('Finances settings changed during migration. Restoring the migration.');
        if (!equal(beforeSettings, this.plugin.settings)) throw new Error('Settings changed while notes were updating. Restoring the migration.');
        if (healthKinds && healthKinds !== JSON.stringify(this.consumer('tps-health')?.settings?.nativeRecordKinds)) throw new Error('Health kinds changed. Review the migration again.');
        this.assertConsumers(plugins);
        this.applyPatches(patches, 'after');
        await this.plugin.saveSettings();
        await this.saveConsumers(plugins);
        await this.plugin.app.vault.adapter.remove(this.recoveryPath);
        this.recoveryPending = false;
        this.refresh(plan.notes);
        logger.log('[property-migration] completed', { notes: plan.notes.length, settingsGroups: patches.length, kind: change.kind });
        new Notice(`Updated ${plan.notes.length} notes and saved the property configuration.`);
        return true;
      } catch (error) {
        try { await this.restore(record); }
        catch { new Notice('Migration stopped. Recovery is still available in GCM Advanced; notes edited since migration are not overwritten.', 0); }
        throw error;
      } finally { this.active = false; }
    } finally { this.active = false; this.busy = false; }
  }
  async recover(): Promise<void> {
    if (this.busy) throw new Error('A property migration is already running.');
    this.busy = true;
    try {
      const record = JSON.parse(await this.plugin.app.vault.adapter.read(this.recoveryPath)) as RecoveryRecord;
      if (record.version !== 1 || !Array.isArray(record.notes) || !Array.isArray(record.patches)
        || record.notes.some(note => typeof note.path !== 'string' || typeof note.before !== 'string' || typeof note.after !== 'string')
        || record.patches.some(patch => typeof patch.key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(patch.key))) throw new Error('Invalid migration recovery file. Preserve it for manual recovery.');
      if (record.plugins?.some(plan => ![...Object.keys(PLUGIN_MAPPING_FIELDS), 'tps-notebook-navigator'].includes(plan.pluginId) || !Array.isArray(plan.patches) || plan.patches.some(patch => ['__proto__', 'constructor', 'prototype'].includes(patch.key)))) throw new Error('Invalid plugin mapping recovery.');
      if (!await PropertyMigrationModal.confirm(this.plugin.app, 'Restore interrupted property migration',
        'Restore the original note properties and GCM configuration. Notes or settings changed since the migration will be left untouched and reported for manual recovery.', record.notes.map(note => note.path))) return;
      this.active = true;
      await this.restore(record);
      new Notice('Property migration restored. You can apply the configuration change again.');
    } finally { this.active = false; this.busy = false; }
  }
  private applyPatches(patches: SettingsPatch[], side: 'before' | 'after'): void {
    for (const patch of patches) {
      if (patch[side] === undefined) delete (this.plugin.settings as any)[patch.key];
      else (this.plugin.settings as any)[patch.key] = clone(patch[side]);
    }
  }
  private async restore(record: RecoveryRecord): Promise<void> {
    const conflicts: string[] = [];
    for (const note of [...record.notes].reverse()) {
      try { await this.write(note, true); }
      catch { conflicts.push(note.path); }
    }
    const safe = record.patches.filter(patch => {
      const current = (this.plugin.settings as any)[patch.key];
      if (equal(current, patch.before) || equal(current, patch.after)) return true;
      conflicts.push(`Setting: ${patch.key}`); return false;
    });
    try { await this.saveConsumers(record.plugins || [], true); } catch (error) { conflicts.push(error instanceof Error ? error.message : String(error)); }
    this.applyPatches(safe, 'before');
    await this.plugin.saveSettings();
    this.refresh(record.notes);
    if (conflicts.length) {
      await PropertyMigrationModal.confirm(this.plugin.app, 'Recovery needs attention', 'These notes or settings changed after migration. Restore them manually using the recovery file in the GCM plugin folder, then retry recovery.', [], conflicts);
      throw new Error(`Recovery preserved ${conflicts.length} concurrent changes; the recovery file was retained.`);
    }
    await this.plugin.app.vault.adapter.remove(this.recoveryPath);
    this.recoveryPending = false;
    logger.log('[property-migration] restored', { notes: record.notes.length });
  }
  private async write(note: NoteChange, restore: boolean): Promise<void> {
    if (this.disposed) throw new Error('GCM was unloaded; recovery is available on the next load.');
    const file = this.plugin.app.vault.getAbstractFileByPath(note.path);
    if (!(file instanceof TFile) || !['md', 'base'].includes(file.extension)) throw new Error(`Note or Base moved or deleted: ${note.path}`);
    const expected = restore ? note.after : note.before, replacement = restore ? note.before : note.after;
    if (file.extension === 'base') await this.plugin.app.vault.process(file, current => {
      if (current === replacement) return current;
      if (current !== expected) throw new Error(`Base changed since preview: ${file.path}`);
      return replacement;
    });
    else await this.plugin.frontmatterMutationService.applyMigrationSource(file, expected, replacement);
  }
  private refresh(notes: NoteChange[]): void {
    try {
      this.plugin.nativeRecordService?.refreshConfiguration();
      this.consumer('tps-health')?.nativeRecordService?.refreshConfiguration?.();
      this.plugin.eventService.emitFilesUpdated(notes.filter(note => note.path.endsWith('.md')).map(note => note.path), { sourcePluginId: this.plugin.manifest.id });
      this.plugin.notebookNavigatorRuleService?.invalidateNotebookNavigatorPresentation();
    } catch { logger.warn('[property-migration] refresh deferred until next open'); }
  }
}
