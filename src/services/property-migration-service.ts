import { MANAGED_NOTE_FIELDS, managedNoteFieldKey } from '../utils/managed-note-fields';
import { PLUGIN_MAPPING_FIELDS, pluginMappingPatches, type PluginSettingsPatch } from '../utils/plugin-mapping-references';
import { Notice, TFile } from 'obsidian';
import type TPSGlobalContextMenuPlugin from '../main';
import { PropertyMigrationModal } from '../modals/property-migration-modal';
import { migrateNoteProperties, PropertyMigration, SettingsPatch, settingsPatches, updateMigrationReferences, validateMigration, validateMigrationSettings } from '../utils/property-migration';
import * as logger from '../logger';

interface NoteChange { path: string; before: string; after: string }
interface MigrationPlan { notes: NoteChange[]; blocked: string[] }
interface RecoveryRecord { version: 1; notes: NoteChange[]; patches: SettingsPatch[]; plugins?: PluginSettingsPatch[] }
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
  async preview(change: PropertyMigration): Promise<MigrationPlan> {
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
          const after = migrateNoteProperties(before, change);
          if (after !== before) notes.push({ path: file.path, before, after });
        } catch (error) { blocked.push(`${file.path}: ${error instanceof Error ? error.message : String(error)}`); }
        completed++;
        if (completed % 100 === 0) progress.setMessage?.(`Scanning note properties: ${completed} / ${files.length}`);
      }
    };
    try { await Promise.race([Promise.all(Array.from({ length: Math.min(8, files.length) }, worker)), cancellation]); }
    finally { this.cancelScan = null; progress.hide?.(); }
    notes.sort((a, b) => a.path.localeCompare(b.path));
    blocked.sort();
    return { notes, blocked };
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
    const fromKeys = [...new Set(kinds.map(kind => this.plugin.nativeRecordService.getStorageProfile(kind).kindPropertyKey))];
    if (fromKeys.length !== 1) throw new Error('Health records have inconsistent key mappings. Repair these before migrating.');
    if (fromKeys[0] === to) return false;
    const profile = this.plugin.nativeRecordService.getStorageProfile(kinds[0]);
    if (['identityPropertyKey', 'schemaPropertyKey', 'titlePropertyKey', 'createdPropertyKey', 'modifiedPropertyKey'].some(field => String((profile as any)[field] || '').toLowerCase() === to.toLowerCase())) throw new Error('This key belongs to the shared record envelope.');
    if (Object.values(health.settings.nativeRecordProperties || {}).some(key => String(key).toLowerCase() === to.toLowerCase())
      || [health.settings.workoutStartPropertyKey, health.settings.workoutIntervalPropertyKey].some(key => String(key).toLowerCase() === to.toLowerCase())) throw new Error('Another Health field already uses this key.');
    return this.request({ kind: 'key', from: fromKeys[0], to, recordKinds: kinds }, settings => {
      settings.nativeRecordKindPropertyKeys = { ...settings.nativeRecordKindPropertyKeys, ...Object.fromEntries(kinds.map(kind => [kind, to])) };
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
      await owner.saveSettings();
      owner.nativeRecordService?.refreshConfiguration?.();
    }
  }
  async request(change: PropertyMigration, configure: (settings: typeof this.plugin.settings) => void): Promise<boolean> {
    if (this.disposed) throw new Error('GCM was reloaded. Reopen its settings before migrating.');
    if (this.busy || this.recoveryPending) throw new Error('Finish or restore the previous property migration first.');
    if (change.kind === 'key' && !change.recordKinds) {
      const field = MANAGED_NOTE_FIELDS.find(field => managedNoteFieldKey(this.plugin.settings, field).toLowerCase() === change.from.toLowerCase());
      if (field) change = { ...change, previousKeys: [field, ...(this.plugin.settings.managedNoteFieldAliases?.[field] || [])] };
    }
    validateMigration(change);
    validateMigrationSettings(this.plugin.settings, change);
    this.busy = true;
    try {
      const beforeSettings = clone(this.plugin.settings);
      const afterSettings = clone(beforeSettings);
      updateMigrationReferences(afterSettings, change);
      configure(afterSettings);
      const patches = settingsPatches(beforeSettings, afterSettings);
      const plugins = (change.kind === 'key' && change.recordKinds ? [] : Object.keys(PLUGIN_MAPPING_FIELDS)).flatMap(pluginId => {
        const owner = this.consumer(pluginId);
        if (!owner?.settings) return [];
        const patches = pluginMappingPatches(pluginId, owner.settings, change);
        return patches.length ? [{ pluginId, patches }] : [];
      });
      const healthKinds = change.kind === 'key' && change.recordKinds ? JSON.stringify(this.consumer('tps-health')?.settings?.nativeRecordKinds) : null;
      const plan = await this.preview(change);
      if (this.disposed) throw new Error('GCM was reloaded. Apply again to review a fresh preview.');
      const scope = change.kind === 'key' && change.recordKinds ? 'Only logged Health entries and workout sessions are included; reusable templates and other record types keep their keys.' : 'Includes archived notes and templates.';
      const name = change.kind === 'key' ? `Rename property “${change.from}” → “${change.to}”` : `Rename ${change.key} value “${change.from}” → “${change.to}”`;
      const confirmed = await PropertyMigrationModal.confirm(this.plugin.app, name,
        `${plan.notes.length} Markdown notes will change. ${scope} This updates frontmatter only. Exact string values and list items match; note bodies, inline fields, and Base formulas are not rewritten. Matching mappings in enabled TPS plugins update together; disabled plugins must be enabled before migrating their fields. ${patches.length} GCM settings groups and ${plugins.length} TPS plugins will update. A temporary local recovery copy is kept until completion.`,
        plan.notes.map(note => note.path), plan.blocked);
      if (!confirmed) return false;
      if (this.disposed) throw new Error('GCM was reloaded. Apply again to review a fresh preview.');
      if (!equal(beforeSettings, this.plugin.settings)) throw new Error('Settings changed during preview. Apply again to review a fresh preview.');
      if (healthKinds && healthKinds !== JSON.stringify(this.consumer('tps-health')?.settings?.nativeRecordKinds)) throw new Error('Health kinds changed. Review the migration again.');
      this.assertConsumers(plugins);
      const fresh = await this.preview(change);
      if (fresh.blocked.length || !equal(plan.notes, fresh.notes)) throw new Error('Notes changed during preview. Apply again to review a fresh preview.');
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
      if (record.plugins?.some(plan => !Object.prototype.hasOwnProperty.call(PLUGIN_MAPPING_FIELDS, plan.pluginId) || !Array.isArray(plan.patches) || plan.patches.some(patch => ['__proto__', 'constructor', 'prototype'].includes(patch.key)))) throw new Error('Invalid plugin mapping recovery.');
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
    if (!(file instanceof TFile) || file.extension !== 'md') throw new Error(`Note moved or deleted: ${note.path}`);
    await this.plugin.frontmatterMutationService.applyMigrationSource(file, restore ? note.after : note.before, restore ? note.before : note.after);
  }
  private refresh(notes: NoteChange[]): void {
    try {
      this.plugin.nativeRecordService?.refreshConfiguration();
      this.consumer('tps-health')?.nativeRecordService?.refreshConfiguration?.();
      this.plugin.eventService.emitFilesUpdated(notes.map(note => note.path), { sourcePluginId: this.plugin.manifest.id });
      this.plugin.notebookNavigatorRuleService?.invalidateNotebookNavigatorPresentation();
    } catch { logger.warn('[property-migration] refresh deferred until next open'); }
  }
}
