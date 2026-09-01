import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const settingsTabSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const parentLinkFormatSource = readFileSync(new URL('../src/handlers/parent-link-format.ts', import.meta.url), 'utf8');
const registerEventsSource = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');
const panelBuilderSource = readFileSync(new URL('../src/menu/panel-builder.ts', import.meta.url), 'utf8');
const menuBuilderSource = readFileSync(new URL('../src/menu/menu-builder.ts', import.meta.url), 'utf8');
const archiveFileServiceSource = readFileSync(new URL('../src/services/archive-file-service.ts', import.meta.url), 'utf8');
const notebookRuleServiceSource = readFileSync(new URL('../src/services/notebook-navigator-rule-service.ts', import.meta.url), 'utf8');
const notebookRuleEngineSource = readFileSync(new URL('../src/services/notebook-navigator-rule-engine.ts', import.meta.url), 'utf8');
const notebookRuleSettingsSource = readFileSync(new URL('../src/services/notebook-navigator-rule-settings.ts', import.meta.url), 'utf8');
const notebookUiCommonSource = readFileSync(new URL('../src/notebook-navigator-settings/ui-common.ts', import.meta.url), 'utf8');
const notebookOperatorsSource = readFileSync(new URL('../src/notebook-navigator-settings/operators.ts', import.meta.url), 'utf8');
const notebookRulesSectionSource = readFileSync(new URL('../src/notebook-navigator-settings/rules-section.ts', import.meta.url), 'utf8');
const notebookBucketSectionSource = readFileSync(new URL('../src/notebook-navigator-settings/bucket-section.ts', import.meta.url), 'utf8');
const notebookHideSectionSource = readFileSync(new URL('../src/notebook-navigator-settings/hide-section.ts', import.meta.url), 'utf8');
const fileNamingServiceSource = readFileSync(new URL('../src/services/file-naming-service.ts', import.meta.url), 'utf8');
const settingsPersistenceSource = readFileSync(new URL('../src/settings-persistence.ts', import.meta.url), 'utf8');
const timeTrackingSource = readFileSync(new URL('../src/services/time-tracking-service.ts', import.meta.url), 'utf8');

async function importModule(relativePath) {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    external: ['obsidian'],
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

async function importNativeRecordStorageModule() {
  const build = await esbuild.build({
    stdin: {
      contents: "export { resolveWritableNativeRecordStorageConfiguration } from '../src/services/native-record-service.ts';",
      resolveDir: fileURLToPath(new URL('.', import.meta.url)),
      sourcefile: 'native-record-storage-settings-harness.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'native-record-storage-settings-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'native-record-storage-settings' }));
        builder.onResolve({ filter: /^\.\.\/logger$/u }, () => ({ path: 'logger', namespace: 'native-record-storage-settings' }));
        builder.onLoad({ filter: /.*/, namespace: 'native-record-storage-settings' }, (args) => ({
          loader: 'js',
          contents: args.path === 'logger'
            ? 'export const flow = () => {}; export const flowError = () => {};'
            : `
              export class TFile {}
              export class TFolder {}
              export const normalizePath = (value) => String(value || '');
              export const parseYaml = () => ({});
              export const stringifyYaml = () => '';
            `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

test('linked subitem mapping presentation fields survive textarea-style parse results', async () => {
  const { mergeLinkedSubitemMappingPresentation } = await importModule('../src/utils/linked-subitem-mapping.ts');

  const parsed = [
    { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete' },
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '*', statuses: ['waiting'], toggleTargetStatus: 'todo' },
  ];
  const existing = [
    { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete', icon: 'square', label: 'Todo' },
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo', icon: 'check', label: 'Complete' },
  ];

  assert.deepEqual(mergeLinkedSubitemMappingPresentation(parsed, existing), [
    { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete', icon: 'square', label: 'Todo' },
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo', icon: 'check', label: 'Complete' },
    { checkboxState: '[*]', statuses: ['waiting'], toggleTargetStatus: 'todo', icon: undefined, label: undefined },
  ]);
});

test('checkbox mapping normalization preserves primary row order and rejects unsupported tokens deterministically', async () => {
  const {
    getLinkedSubitemCompleteMarkers,
    mapStatusToSubitemCheckboxState,
    mapSubitemCheckboxStateToStatus,
    normalizeLinkedSubitemCheckboxMarker,
    normalizeLinkedSubitemCheckboxState,
    normalizeLinkedSubitemMappings,
  } = await importModule('../src/utils/linked-subitem-mapping.ts');
  const source = [
    { checkboxState: '[ ]', statuses: ['todo'] },
    { checkboxState: '[x]', statuses: ['complete'] },
    { checkboxState: '[\\]', statuses: ['working'] },
    { checkboxState: '[?]', statuses: ['holding'] },
    { checkboxState: '[-]', statuses: ['wont-do'] },
    { checkboxState: '[>]', statuses: ['migrated'] },
    { checkboxState: '[/]', statuses: ['working'] },
    { checkboxState: '[custom]', statuses: ['invalid'] },
    { checkboxState: '[?]', statuses: ['duplicate-must-not-win'] },
  ];

  const normalized = normalizeLinkedSubitemMappings(source, { enforceStrictDefaults: true });
  assert.deepEqual(normalized.map((entry) => entry.checkboxState), ['[ ]', '[x]', '[\\]', '[?]', '[-]', '[>]', '[/]']);
  assert.equal(mapStatusToSubitemCheckboxState(normalized, 'working'), '[\\]');
  assert.equal(mapSubitemCheckboxStateToStatus(normalized, '[?]'), 'holding');
  assert.equal(mapSubitemCheckboxStateToStatus(normalized, '[X]'), 'complete');
  assert.equal(mapSubitemCheckboxStateToStatus(normalized, '[custom]'), null);
  assert.equal(normalizeLinkedSubitemCheckboxState(' '), '[ ]');
  assert.equal(normalizeLinkedSubitemCheckboxState('[X]'), '[x]');
  assert.equal(normalizeLinkedSubitemCheckboxMarker('[X]'), 'x');
  assert.equal(normalizeLinkedSubitemCheckboxMarker('X'), 'x');
  assert.equal(normalizeLinkedSubitemCheckboxMarker('[custom]'), null);
  assert.equal(normalizeLinkedSubitemCheckboxState('🟢'), null);
  assert.equal(normalizeLinkedSubitemCheckboxState('[🟢]'), null);
  assert.deepEqual(
    getLinkedSubitemCompleteMarkers([{ checkboxState: '[*]', statuses: ['complete'] }]),
    ['*'],
    'completion markers must come from the supplied mapping instead of an implicit x marker',
  );
  assert.deepEqual(
    getLinkedSubitemCompleteMarkers(
      [{ checkboxState: '[*]', statuses: ['complete'] }],
      { completionStatuses: [] },
    ),
    [],
    'an explicit empty completion set must not silently recreate complete/wont-do authority',
  );
});

test('task completion metadata distinguishes absent defaults from explicit empty authority', async () => {
  const { updateTaskCompletedDateForCheckboxState } = await importModule('../src/utils/task-line-metadata.ts');
  const completed = '- [x] Done [completedDate:: 2026-08-01 10:00:00]';
  assert.equal(
    updateTaskCompletedDateForCheckboxState(completed, '[x]', { completeMarkers: [] }),
    '- [x] Done',
  );
  assert.match(
    updateTaskCompletedDateForCheckboxState('- [x] Done', '[x]', {
      completedAt: new Date(2026, 7, 2, 9, 30, 0),
    }),
    /\[completedDate:: 2026-08-02 09:30:00\]/u,
  );
});

test('Daily Note move behavior and local item history have safe normalized settings', () => {
  assert.match(typesSource, /DailyNoteTaskMoveSourceBehavior = 'mark-migrated' \| 'remove'/u);
  assert.match(typesSource, /dailyNoteTaskMoveSourceBehavior: DailyNoteTaskMoveSourceBehavior;/u);
  assert.match(typesSource, /enableItemHistory: boolean;/u);
  assert.match(constantsSource, /dailyNoteTaskMoveSourceBehavior: 'mark-migrated'/u);
  assert.match(constantsSource, /enableItemHistory: true/u);
  assert.match(constantsSource, /itemHistoryRetentionDays: 90/u);
  assert.match(constantsSource, /itemHistoryMaxEntries: 25000/u);
  assert.match(mainSource, /dailyNoteTaskMoveSourceBehavior !== 'mark-migrated'/u);
  assert.match(mainSource, /dailyNoteTaskMoveSourceBehavior !== 'remove'/u);
  assert.match(mainSource, /this\.settings\.enableItemHistory = this\.settings\.enableItemHistory !== false/u);
  assert.match(mainSource, /Math\.min\(365, Math\.max\(1, Math\.floor\(itemHistoryRetentionDays\)\)\)/u);
  assert.match(mainSource, /Math\.min\(25000, Math\.max\(100, Math\.floor\(itemHistoryMaxEntries\)\)\)/u);
  assert.match(settingsTabSource, /After moving a task from a Daily Note/u);
  assert.match(settingsTabSource, /Keep a migrated marker/u);
  assert.match(settingsTabSource, /Remove the source block/u);
  assert.match(settingsTabSource, /Keep local item history/u);
  assert.match(settingsTabSource, /first tracked change, a surviving task receives a stable tpsId/u);
  assert.match(settingsTabSource, /Vault-relative before\/after note paths, including filenames, are stored/u);
  assert.match(settingsTabSource, /Raw task content and note bodies are never stored/u);
  const historyToggle = settingsTabSource.slice(
    settingsTabSource.indexOf(".setName('Keep local item history')"),
    settingsTabSource.indexOf(".setName('Item history retention')"),
  );
  assert.match(
    historyToggle,
    /enableItemHistory = value;[\s\S]*updateEnabled\(value\);[\s\S]*await this\.plugin\.saveSettings\(\)/u,
    'recording lifecycle changes before persistence so in-flight work cannot cross an opt-out',
  );
  assert.match(
    historyToggle,
    /catch \(error\) \{[\s\S]*enableItemHistory = previous;[\s\S]*updateEnabled\(previous\);/u,
    'a failed settings save restores both the setting and the item-history lifecycle',
  );
});

test('linked context, parent-child ignore, and completed-task scope settings normalize safely', () => {
  const linkedContextSettingsStart = settingsTabSource.indexOf('private renderLinkedContextSettings');
  const linkedContextSettingsEnd = settingsTabSource.indexOf('private bindNotebookNavigatorCommittedText', linkedContextSettingsStart);
  const linkedContextSettingsSource = settingsTabSource.slice(linkedContextSettingsStart, linkedContextSettingsEnd);
  const menusSurfaceStart = settingsTabSource.indexOf("if (this.activeSettingsPage === 'menus-surfaces')");
  const menusSurfaceEnd = settingsTabSource.indexOf("if (this.activeSettingsPage === 'appearance')", menusSurfaceStart);
  const menusSurfaceSource = settingsTabSource.slice(menusSurfaceStart, menusSurfaceEnd);
  const childNotesStart = settingsTabSource.indexOf("if (this.activeWorkflowPage === 'child-notes')");
  const childNotesEnd = settingsTabSource.indexOf("if (this.activeWorkflowPage === 'recurrence')", childNotesStart);
  const childNotesSource = settingsTabSource.slice(childNotesStart, childNotesEnd);

  assert.match(typesSource, /CompletedTaskHidingScope = 'reading-and-live-preview' \| 'reading-only'/u);
  assert.match(typesSource, /LinkedContextSortOrder = 'source-asc' \| 'source-desc'/u);
  assert.match(constantsSource, /completedTaskHidingScope: 'reading-and-live-preview'/u);
  assert.match(constantsSource, /linkedContextSortOrder: 'source-asc'/u);
  assert.match(constantsSource, /enableParentChildIgnoreRule: false/u);
  assert.match(constantsSource, /parentChildIgnoreFrontmatterKey: ''/u);
  assert.match(constantsSource, /parentChildIgnoreFrontmatterValue: ''/u);
  assert.match(mainSource, /linkedContextSortOrder === 'source-desc'[\s\S]{0,100}\? 'source-desc'[\s\S]{0,80}: 'source-asc'/u);
  assert.match(mainSource, /completedTaskHidingScope === 'reading-only'[\s\S]{0,100}\? 'reading-only'[\s\S]{0,100}: 'reading-and-live-preview'/u);
  assert.match(mainSource, /enableParentChildIgnoreRule = this\.settings\.enableParentChildIgnoreRule === true/u);
  assert.match(mainSource, /parentChildIgnoreFrontmatterKey = String\([^)]*\)\.trim\(\)/u);
  assert.match(mainSource, /parentChildIgnoreFrontmatterValue = String\([^)]*\)\.trim\(\)/u);
  assert.match(settingsTabSource, /setName\('Hide completed tasks in'\)/u);
  assert.match(settingsTabSource, /addOption\('reading-only', 'Reading view only'\)/u);
  assert.match(linkedContextSettingsSource, /createEl\('h4', \{ text: 'Linked context' \}\)/u);
  assert.match(linkedContextSettingsSource, /setName\('Linked context order'\)/u);
  assert.match(linkedContextSettingsSource, /addOption\('source-desc', 'Source path Z → A'\)/u);
  assert.match(menusSurfaceSource, /this\.renderLinkedContextSettings\(activePage\)/u);
  assert.doesNotMatch(childNotesSource, /Linked context order|renderLinkedContextSettings/u);
  assert.match(settingsTabSource, /setName\('Ignore matching parent\/child notes'\)/u);
  assert.match(settingsTabSource, /Existing links and frontmatter are preserved/u);
  assert.match(settingsTabSource, /linkedSubitemCheckboxService\.ensureForAllMarkdownViews\(\)/u);
  assert.match(settingsTabSource, /linkedSubitemCheckboxService\.refreshLivePreviewEditors\(\)/u);
  assert.ok(
    linkedContextSettingsSource.indexOf("setName('Linked context order')")
      < linkedContextSettingsSource.indexOf("if (this.plugin.settings.enableLinkedContextPanel === true)"),
    'linked-context order remains configurable while the panel evaluator is off',
  );
  assert.ok(
    settingsTabSource.indexOf("setName('Parent/child ignore pair')")
      > settingsTabSource.indexOf("setName('Ignore matching parent/child notes')"),
  );
  assert.ok(
    settingsTabSource.indexOf("setName('Parent/child ignore pair')")
      < settingsTabSource.indexOf("setName('Body link format')"),
    'the exact ignore pair remains editable while its evaluator is disabled',
  );
});

test('checkbox mapping text validation keeps alternate markers but rejects ambiguous or unusable rows', async () => {
  const { parseLinkedSubitemMappingsText } = await importModule('../src/utils/linked-subitem-mapping.ts');
  const valid = [
    '[ ]: todo => complete',
    '[x]: complete => todo',
    '[/]: working => complete',
    '[\\]: working => complete',
    '[?]: holding => todo',
    '[-]: wont-do => todo',
    '[>]: migrated => todo',
  ].join('\n');
  const parsed = parseLinkedSubitemMappingsText(valid);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.mappings.length, 7);
  assert.match(parsed.warnings[0], /primary marker for "working"/u);

  for (const [draft, expected] of [
    [valid.replace('[?]: holding', '[custom]: holding'), /exactly one character/u],
    [`${valid}\n[?]: blocked => todo`, /already defined/u],
    [valid.replace('[/]: working => complete', ''), /Required system mapping \[\/\] is missing/u],
    [valid.replace('[?]: holding => todo', '[?]: holding => reviewing'), /not mapped by any row/u],
    [valid.replace('[?]: holding => todo', '[?]: holding, complete => todo'), /cannot mix completed and open/u],
    [valid.replace('[?]: holding => todo', '[?]: reviewing => todo'), /Required system status "holding" is not mapped/u],
    [valid.replace('[>]: migrated => todo', '[>]: migrated, working => todo'), /reserved for the migrated system status/u],
    [valid.replace('[ ]: todo => complete', '[ ]: complete => todo'), /reserved open checkbox/u],
    [valid.replace('[x]: complete => todo', '[x]: todo => complete'), /reserved checked checkbox/u],
    [valid.replace('[/]: working => complete', '[🟢]: working => complete'), /exactly one character/u],
  ]) {
    const result = parseLinkedSubitemMappingsText(draft);
    assert.ok(result.errors.some((issue) => expected.test(issue.message)), draft);
  }
});

test('public checkbox mapping contract is ordered, strict, frozen, cached, and invalidated by settings replacement', async () => {
  const { createLinkedSubitemCheckboxContract } = await importModule('../src/utils/linked-subitem-mapping.ts');
  let source = [
    { checkboxState: '[o]', statuses: ['todo'], toggleTargetStatus: 'complete' },
    { checkboxState: '[*]', statuses: ['complete'], toggleTargetStatus: 'todo' },
  ];
  const normalizeStatus = (value) => String(value ?? '').trim().toLowerCase();
  const contract = createLinkedSubitemCheckboxContract(() => source, normalizeStatus);

  assert.equal(contract.version, 1);
  assert.equal(contract.contract, 'ordered-strict-v1');
  const first = contract.getMappings();
  assert.equal(contract.getMappings(), first, 'an unchanged settings source must reuse one public snapshot');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first[0]), true);
  assert.equal(Object.isFrozen(first[0].statuses), true);
  assert.equal(first.length, 2, 'the public runtime contract never supplements settings with hidden default rows');
  assert.equal(first[0].checkboxState, '[o]');
  assert.equal(contract.stateForStatus('TODO'), '[o]');
  assert.equal(contract.statusForState('[*]'), 'complete');
  assert.equal(contract.stateForStatus('unmapped'), '');
  assert.equal(contract.statusForState('[!]'), '');
  assert.throws(() => first[0].statuses.push('mutated'), TypeError);

  source = [
    { checkboxState: '[n]', statuses: ['todo'], toggleTargetStatus: 'complete' },
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo' },
  ];
  const second = contract.getMappings();
  assert.notEqual(second, first);
  assert.equal(contract.stateForStatus('todo'), '[n]');
  assert.equal(first[0].checkboxState, '[o]', 'previous snapshots must remain immutable after invalidation');

  source = [
    { checkboxState: '[!]', statuses: ['review'], toggleTargetStatus: 'complete' },
    { checkboxState: '[broken]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  ];
  const partial = contract.getMappings();
  assert.deepEqual(partial.map((mapping) => mapping.checkboxState), ['[!]']);
  assert.equal(contract.stateForStatus('todo'), '', 'a missing default row remains unavailable instead of being synthesized');
  assert.equal(contract.statusForState('[ ]'), '', 'blank never becomes todo unless that exact row exists in settings');
});

test('checkbox mapping settings keep drafts local and expose one explicit accessible apply path', () => {
  const start = settingsTabSource.indexOf('private renderLinkedSubitemCheckboxSettings');
  const end = settingsTabSource.indexOf('private serializeLinkedSubitemMappings', start);
  const source = settingsTabSource.slice(start, end);
  const draftSource = source.slice(source.indexOf('let fallbackDraft'));
  assert.match(source, /Apply mappings/u);
  assert.match(source, /Load defaults/u);
  assert.match(source, /aria-live['"]?:\s*['"]polite/u);
  assert.match(source, /Fallback open marker must be defined by a mapping row/u);
  assert.match(source, /Fallback open marker must map only to open statuses/u);
  assert.match(source, /Used only when a linked child note has no workflow status\. A nonempty unmapped status remains unsupported\./u);
  assert.match(source, /onChange\(\(value\) => \{[\s\S]*?mappingsDraft = value;[\s\S]*?validateDraft\(\);[\s\S]*?\}\)/u);
  assert.doesNotMatch(draftSource, /onChange\(async/u);
  assert.equal((draftSource.match(/await this\.plugin\.saveSettings\(\)/gu) || []).length, 1);
});

test('checkbox mapping load migration uses legacy statuses and persists one canonical snapshot', () => {
  assert.match(mainSource, /statuses: legacyUnchecked\.length > 0 \? legacyUnchecked : \['todo'\]/u);
  assert.match(mainSource, /statuses: legacyChecked\.length > 0 \? legacyChecked : \['complete'\]/u);
  assert.match(mainSource, /statuses: legacyCanceled\.length > 0 \? legacyCanceled : \['wont-do'\]/u);
  assert.match(mainSource, /normalizeLinkedSubitemMappings\(mappingSource, \{[\s\S]{0,100}enforceStrictDefaults: true/u);
  assert.match(mainSource, /const needsCheckboxMappingMigration = Boolean\(loaded\)/u);
  assert.match(mainSource, /needsActivityBasePathMigration \|\|[\s\S]{0,120}needsCheckboxMappingMigration \|\|/u);
  assert.doesNotMatch(mainSource, /getStrictLinkedSubitemMappings|normalizeStrictLinkedSubitemMappings/u);
});

test('settings persistence merges only locally changed keys into the newest disk payload', async () => {
  const { SettingsPersistenceCoordinator } = await importModule('../src/settings-persistence.ts');
  let disk = {
    settingA: 'desktop-old',
    settingB: 'mobile-old',
    lastArchiveTagSweepDate: '',
    futureSetting: { enabled: true },
  };
  const persisted = [];
  const coordinator = new SettingsPersistenceCoordinator(
    async () => structuredClone(disk),
    async (next) => {
      persisted.push(structuredClone(next));
      disk = structuredClone(next);
    },
  );
  coordinator.setBaseline(disk);

  disk.settingB = 'mobile-new';
  await coordinator.request({
    settingA: 'desktop-new',
    settingB: 'mobile-old',
    lastArchiveTagSweepDate: '',
    futureSetting: { enabled: true },
  });
  assert.equal(disk.settingA, 'desktop-new');
  assert.equal(disk.settingB, 'mobile-new');
  assert.deepEqual(disk.futureSetting, { enabled: true });

  coordinator.setBaseline(disk);
  disk.settingA = 'mobile-newer';
  await coordinator.request({
    ...persisted.at(-1),
    lastArchiveTagSweepDate: '2026-07-21',
  });
  assert.equal(disk.settingA, 'mobile-newer');
  assert.equal(disk.lastArchiveTagSweepDate, '2026-07-21');
});

test('authoritative Home defaults persist before an unrelated setting save', async () => {
  const {
    reconcilePersistedSettingsInPlace,
    SettingsPersistenceCoordinator,
  } = await importModule('../src/settings-persistence.ts');
  const homeDefaults = {
    enableDailyNoteHome: true,
    homeCalendarBasePath: 'home-schedule.base',
    homeFoodBasePath: 'Food Log.base',
    homeWorkoutBasePath: 'Activity Log.base',
    homeOpenTasksBasePath: 'Open Unscheduled Tasks.base',
  };
  let disk = { unrelatedSetting: 'old' };
  const live = { ...structuredClone(disk), ...homeDefaults };
  const coordinator = new SettingsPersistenceCoordinator(
    async () => structuredClone(disk),
    async (next) => {
      disk = structuredClone(next);
    },
    (requested, persisted) => {
      reconcilePersistedSettingsInPlace(live, requested, persisted);
    },
  );
  coordinator.setBaseline({ unrelatedSetting: 'old' });

  await coordinator.request(live);
  assert.deepEqual(disk, { unrelatedSetting: 'old', ...homeDefaults });
  assert.deepEqual(live, disk);

  live.unrelatedSetting = 'new';
  await coordinator.request(live);
  assert.deepEqual(disk, { unrelatedSetting: 'new', ...homeDefaults });
  assert.deepEqual(live, disk);
});

test('settings persistence keeps rendered custom-property references live across sequential saves', async () => {
  const {
    reconcilePersistedSettingsInPlace,
    SettingsPersistenceCoordinator,
  } = await importModule('../src/settings-persistence.ts');
  let disk = {
    properties: [{ id: 'status', options: ['todo'] }],
    synchronizedPreference: 'desktop-old',
  };
  const live = structuredClone(disk);
  const renderedProperty = live.properties[0];
  const coordinator = new SettingsPersistenceCoordinator(
    async () => structuredClone(disk),
    async (next) => {
      disk = structuredClone(next);
    },
    (requested, persisted) => {
      reconcilePersistedSettingsInPlace(live, requested, persisted);
    },
  );
  coordinator.setBaseline(disk);

  renderedProperty.options = ['todo', 'working'];
  await coordinator.request(live);

  assert.equal(
    live.properties[0],
    renderedProperty,
    'an identical successful save must not detach the property used by the open settings control',
  );
  assert.deepEqual(disk.properties[0].options, ['todo', 'working']);

  disk.synchronizedPreference = 'mobile-new';
  renderedProperty.options = ['todo', 'working', 'holding'];
  await coordinator.request(live);

  assert.equal(live.properties[0], renderedProperty);
  assert.deepEqual(disk.properties[0].options, ['todo', 'working', 'holding']);
  assert.equal(
    live.synchronizedPreference,
    'mobile-new',
    'genuinely newer synchronized settings must still reconcile into the live object',
  );
});

test('settings reconciliation respects key presence and never overwrites a newer live edit', async () => {
  const { reconcilePersistedSettingsInPlace } = await importModule('../src/settings-persistence.ts');
  const requested = {
    removedRemotely: 'old',
    editedAgain: { value: 'requested' },
  };
  const live = structuredClone(requested);
  live.editedAgain.value = 'newer-live';
  const persisted = {
    addedRemotely: { enabled: true },
    editedAgain: { value: 'remote' },
  };

  reconcilePersistedSettingsInPlace(live, requested, persisted);

  assert.equal(Object.hasOwn(live, 'removedRemotely'), false);
  assert.deepEqual(live.addedRemotely, { enabled: true });
  assert.deepEqual(live.editedAgain, { value: 'newer-live' });
});

test('settings persistence serializes rapid edits and drains the newest snapshot', async () => {
  const { SettingsPersistenceCoordinator } = await importModule('../src/settings-persistence.ts');
  let disk = { folder: 'A', enabled: false };
  let releaseFirst;
  const firstSaveGate = new Promise((resolve) => { releaseFirst = resolve; });
  let saveCount = 0;
  const coordinator = new SettingsPersistenceCoordinator(
    async () => structuredClone(disk),
    async (next) => {
      saveCount += 1;
      if (saveCount === 1) await firstSaveGate;
      disk = structuredClone(next);
    },
  );
  coordinator.setBaseline(disk);

  const first = coordinator.request({ folder: 'AB', enabled: false });
  await Promise.resolve();
  const second = coordinator.request({ folder: 'ABC', enabled: true });
  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(saveCount, 2);
  assert.deepEqual(disk, { folder: 'ABC', enabled: true });
});

test('settings persistence keeps an in-flight revert as the newest intent', async () => {
  const { SettingsPersistenceCoordinator } = await importModule('../src/settings-persistence.ts');
  let disk = { value: 'old', synchronized: 'keep' };
  let releaseFirst;
  let firstWriteStarted;
  const firstStarted = new Promise((resolve) => { firstWriteStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const writes = [];
  const coordinator = new SettingsPersistenceCoordinator(
    async () => structuredClone(disk),
    async (next) => {
      writes.push(structuredClone(next));
      if (writes.length === 1) {
        firstWriteStarted();
        await firstGate;
      }
      disk = structuredClone(next);
    },
  );
  coordinator.setBaseline(disk);

  const first = coordinator.request({ value: 'new', synchronized: 'keep' });
  await firstStarted;
  const reverted = coordinator.request({ value: 'old', synchronized: 'keep' });
  releaseFirst();
  await Promise.all([first, reverted]);

  assert.deepEqual(writes.map((entry) => entry.value), ['new', 'old']);
  assert.equal(disk.value, 'old');
});

test('a third settings request cannot erase a queued revert intent', async () => {
  const { SettingsPersistenceCoordinator } = await importModule('../src/settings-persistence.ts');
  let disk = { value: 'old', other: 'old' };
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let writes = 0;
  const coordinator = new SettingsPersistenceCoordinator(
    async () => structuredClone(disk),
    async (next) => {
      writes += 1;
      if (writes === 1) {
        markFirstStarted();
        await firstGate;
      }
      disk = structuredClone(next);
    },
  );
  coordinator.setBaseline(disk);

  const first = coordinator.request({ value: 'new', other: 'old' });
  await firstStarted;
  const reverted = coordinator.request({ value: 'old', other: 'old' });
  const third = coordinator.request({ value: 'old', other: 'new' });
  releaseFirst();
  await Promise.all([first, reverted, third]);

  assert.equal(writes, 2);
  assert.deepEqual(disk, { value: 'old', other: 'new' });
});

test('a newer settings snapshot supersedes a failed in-flight write', async () => {
  const { SettingsPersistenceCoordinator } = await importModule('../src/settings-persistence.ts');
  let disk = { value: 'old' };
  let releaseFailure;
  let firstWriteStarted;
  const firstStarted = new Promise((resolve) => { firstWriteStarted = resolve; });
  const failureGate = new Promise((resolve) => { releaseFailure = resolve; });
  let attempts = 0;
  const coordinator = new SettingsPersistenceCoordinator(
    async () => structuredClone(disk),
    async (next) => {
      attempts += 1;
      if (attempts === 1) {
        firstWriteStarted();
        await failureGate;
        throw new Error('first write failed');
      }
      disk = structuredClone(next);
    },
  );
  coordinator.setBaseline(disk);

  const first = coordinator.request({ value: 'first' });
  await firstStarted;
  const newest = coordinator.request({ value: 'newest' });
  releaseFailure();
  await Promise.all([first, newest]);

  assert.equal(attempts, 2);
  assert.equal(disk.value, 'newest');
});

test('a request queued at drain completion starts a new durable drain', async () => {
  const { SettingsPersistenceCoordinator } = await importModule('../src/settings-persistence.ts');
  let disk = { value: 'old' };
  let coordinator;
  let completionWindowRequest;
  let writeCount = 0;
  coordinator = new SettingsPersistenceCoordinator(
    async () => structuredClone(disk),
    async (next) => {
      writeCount += 1;
      disk = structuredClone(next);
      if (writeCount === 1) {
        queueMicrotask(() => queueMicrotask(() => {
          completionWindowRequest = coordinator.request({ value: 'newest' });
        }));
      }
    },
  );
  coordinator.setBaseline(disk);

  await coordinator.request({ value: 'first' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await completionWindowRequest;

  assert.equal(writeCount, 2);
  assert.equal(disk.value, 'newest');
  await coordinator.waitForIdle();
});

test('settings controls use immediate persistence rather than unload-unsafe timers', () => {
  assert.doesNotMatch(mainSource, /private debouncedSave = debounce/);
  assert.doesNotMatch(settingsTabSource, /const debouncedSave = debounce/);
  assert.match(mainSource, /await this\.persistSettingsSnapshot\(\);/);
  assert.match(settingsPersistenceSource, /await this\.loadLatest\(\)/);
  assert.match(settingsPersistenceSource, /mergeChangedSettings\(latest, requested\.snapshot, requested\.changedKeys\)/);
  assert.match(timeTrackingSource, /await this\.plugin\.persistRuntimeSettingsState\(\)/);
  assert.doesNotMatch(timeTrackingSource, /saveData\(this\.plugin\.settings\)/);
  assert.equal(
    (mainSource.match(/this\.saveData\(/g) ?? []).length,
    1,
    'only the persistence coordinator adapter may call saveData directly',
  );
  assert.match(mainSource, /if \(needsSettingsMigration\) await this\.persistSettingsSnapshot\(\);/);
});

test('legacy tag identity settings resolve to a property writer and retain the exact tag reader', async () => {
  const { resolveWritableNativeRecordStorageConfiguration } = await importNativeRecordStorageModule();
  const configuredTagProfile = {
    identityMode: 'tag',
    identityPropertyKey: 'stableRecordId',
    schemaPropertyKey: 'recordSchema',
    identityTagPrefix: 'custom/record',
    kindPropertyKey: '',
    titlePropertyKey: 'displayName',
    createdPropertyKey: 'createdAt',
    modifiedPropertyKey: 'updatedAt',
  };
  const existingPropertyAlias = {
    ...configuredTagProfile,
    identityMode: 'property',
    kindPropertyKey: 'recordKind',
  };

  const resolved = resolveWritableNativeRecordStorageConfiguration(
    configuredTagProfile,
    [existingPropertyAlias],
  );

  assert.equal(resolved.retiredTagIdentity, true);
  assert.equal(resolved.requiresSettingsMigration, true);
  assert.equal(resolved.configuredProfile.identityMode, 'tag');
  assert.equal(resolved.writeProfile.identityMode, 'property');
  assert.equal(resolved.writeProfile.identityPropertyKey, 'tpsId');
  assert.equal(resolved.writeProfile.schemaPropertyKey, '');
  assert.equal(resolved.writeProfile.kindPropertyKey, 'kind');
  assert.equal(resolved.writeProfile.titlePropertyKey, 'title');
  assert.equal(resolved.writeProfile.createdPropertyKey, '');
  assert.equal(resolved.writeProfile.modifiedPropertyKey, '');
  assert.deepEqual(resolved.readAliases[0], configuredTagProfile);
  assert.deepEqual(resolved.readAliases[1], existingPropertyAlias);
});

test('tag identity retirement uses serialized settings persistence without rewriting notes on load', async () => {
  const { SettingsPersistenceCoordinator } = await importModule('../src/settings-persistence.ts');
  const legacyTagProfile = {
    identityMode: 'tag',
    identityPropertyKey: 'tpsId',
    schemaPropertyKey: 'tpsSchemaVersion',
    identityTagPrefix: 'custom/record',
    kindPropertyKey: 'kind',
    titlePropertyKey: 'title',
    createdPropertyKey: 'createdDate',
    modifiedPropertyKey: 'modifiedDate',
  };
  let disk = {
    nativeRecordIdentityMode: 'tag',
    nativeRecordStorageAliases: [],
    unrelatedSetting: 'before',
  };
  const requested = {
    ...disk,
    nativeRecordIdentityMode: 'property',
    nativeRecordStorageAliases: [legacyTagProfile],
  };
  const coordinator = new SettingsPersistenceCoordinator(
    async () => structuredClone(disk),
    async (next) => {
      disk = structuredClone(next);
    },
  );
  coordinator.setBaseline(disk);
  disk.unrelatedSetting = 'changed-concurrently';

  await coordinator.request(requested);

  assert.equal(disk.nativeRecordIdentityMode, 'property');
  assert.deepEqual(disk.nativeRecordStorageAliases, [legacyTagProfile]);
  assert.equal(disk.unrelatedSetting, 'changed-concurrently');

  const loadSettingsStart = mainSource.indexOf('async loadSettings(): Promise<void>');
  const loadSettingsEnd = mainSource.indexOf('private normalizeHomeComponents(', loadSettingsStart);
  const loadSettingsSource = mainSource.slice(loadSettingsStart, loadSettingsEnd);
  assert.ok(loadSettingsStart >= 0 && loadSettingsEnd > loadSettingsStart);
  assert.match(loadSettingsSource, /resolveWritableNativeRecordStorageConfiguration\([\s\S]{0,180}loaded\?\.nativeRecordStorageAliases/);
  assert.match(loadSettingsSource, /const nativeRecordStorageProfile = nativeRecordStorageConfiguration\.writeProfile;/);
  assert.match(loadSettingsSource, /this\.settings\.nativeRecordStorageAliases = nativeRecordStorageConfiguration\.readAliases;/);
  assert.match(loadSettingsSource, /hasRawNativeRecordStorageRepair = nativeRecordStorageSettingValues\.some/);
  assert.match(loadSettingsSource, /hasRawNativeRecordStorageAliasRepair = \([\s\S]{0,500}JSON\.stringify\(nativeRecordStorageConfiguration\.readAliases\)/);
  assert.match(loadSettingsSource, /needsNativeRecordIdentityMigration = nativeRecordStorageConfiguration\.requiresSettingsMigration\s*\|\| hasRawNativeRecordStorageRepair\s*\|\| hasRawNativeRecordStorageAliasRepair/);
  assert.match(loadSettingsSource, /originalStorageValue\('nativeRecordIdentityPropertyKey',[\s\S]{0,900}originalStorageValue\('nativeRecordTitlePropertyKey/);
  assert.match(loadSettingsSource, /nativeRecordStorageAliases: originalStorageValue\('nativeRecordStorageAliases', \[\]\)/);
  assert.match(loadSettingsSource, /needsNativeRecordIdentityMigration = nativeRecordStorageConfiguration\.requiresSettingsMigration/);
  assert.match(loadSettingsSource, /needsNativeRecordIdentityMigration[\s\S]{0,500}if \(needsSettingsMigration\) await this\.persistSettingsSnapshot\(\);/);
  assert.match(loadSettingsSource, /migration:native-record-property-identity'[\s\S]{0,220}noteRewrite: false/);
  assert.doesNotMatch(loadSettingsSource, /nativeRecordService\.migrateStorageProfile\(/);
});

test('sanitized native record aliases replace the raw persisted alias array', async () => {
  const { resolveWritableNativeRecordStorageConfiguration } = await importNativeRecordStorageModule();
  const { SettingsPersistenceCoordinator } = await importModule('../src/settings-persistence.ts');
  const legacyTagProfile = {
    identityMode: 'tag',
    identityPropertyKey: 'tpsId',
    schemaPropertyKey: 'tpsSchemaVersion',
    identityTagPrefix: 'custom/record',
    kindPropertyKey: 'kind',
    titlePropertyKey: 'title',
    createdPropertyKey: 'createdDate',
    modifiedPropertyKey: 'modifiedDate',
  };
  const rawAliases = [legacyTagProfile, structuredClone(legacyTagProfile)];
  const resolved = resolveWritableNativeRecordStorageConfiguration({ identityMode: 'property' }, rawAliases);
  assert.deepEqual(resolved.readAliases, [legacyTagProfile], 'duplicate raw aliases are sanitized deterministically');

  let disk = {
    nativeRecordIdentityMode: 'property',
    nativeRecordStorageAliases: structuredClone(rawAliases),
    unrelatedSetting: 'preserve',
  };
  const requested = {
    ...disk,
    nativeRecordStorageAliases: structuredClone(resolved.readAliases),
  };
  const coordinator = new SettingsPersistenceCoordinator(
    async () => structuredClone(disk),
    async (next) => {
      disk = structuredClone(next);
    },
  );
  coordinator.setBaseline(disk);

  await coordinator.request(requested);

  assert.deepEqual(disk.nativeRecordStorageAliases, [legacyTagProfile]);
  assert.equal(disk.unrelatedSetting, 'preserve');
});

test('native record settings explain the fixed canonical envelope without exposing storage-key editors', () => {
  const nativeSettingsStart = settingsTabSource.indexOf("diagnostics.createEl('h4', { text: 'Native record properties' })");
  const nativeSettingsEnd = settingsTabSource.indexOf("diagnostics.createEl('h4', { text: 'Template identity' })", nativeSettingsStart);
  const nativeSettingsSource = settingsTabSource.slice(nativeSettingsStart, nativeSettingsEnd);

  assert.ok(nativeSettingsStart >= 0 && nativeSettingsEnd > nativeSettingsStart);
  assert.match(nativeSettingsSource, /setName\('Canonical record envelope'\)/);
  assert.match(nativeSettingsSource, /one system identity \(tpsId\) plus kind and title/);
  assert.match(nativeSettingsSource, /Schema and file timestamps remain available virtually through the API/);
  assert.doesNotMatch(nativeSettingsSource, /setName\('Store record identity as'\)/);
  assert.doesNotMatch(nativeSettingsSource, /addOption\('tag', 'Tag'\)/);
  assert.doesNotMatch(nativeSettingsSource, /setName\('Identity tag prefix'\)/);
  assert.doesNotMatch(nativeSettingsSource, /nativeRecordIdentityPropertyKey|nativeRecordSchemaPropertyKey/);
  assert.doesNotMatch(nativeSettingsSource, /nativeRecordKindPropertyKey|nativeRecordTitlePropertyKey/);
  assert.doesNotMatch(nativeSettingsSource, /nativeRecordCreatedPropertyKey|nativeRecordModifiedPropertyKey/);
  assert.match(nativeSettingsSource, /Legacy readers stay enabled for records that arrive later through Sync/);
  assert.match(nativeSettingsSource, /setButtonText\('Consolidate records'\)/);
});

test('TPS Base write fallback settings default safely and persist every Tasks workflow choice', () => {
  const tasksStart = settingsTabSource.indexOf("if (this.activeWorkflowPage === 'tasks')");
  const tasksEnd = settingsTabSource.indexOf("if (this.activeWorkflowPage === 'child-notes')", tasksStart);
  const tasksSource = settingsTabSource.slice(tasksStart, tasksEnd);

  assert.ok(tasksStart >= 0 && tasksEnd > tasksStart, 'Tasks workflow settings must remain directly reachable');
  assert.match(typesSource, /export type TpsBaseWriteFallbackMode = 'filter-required' \| 'today-daily-note' \| 'specific-note';/);
  assert.match(typesSource, /tpsBaseWriteFallbackMode: TpsBaseWriteFallbackMode;/);
  assert.match(typesSource, /tpsBaseWriteFallbackPath: string;/);
  assert.match(constantsSource, /tpsBaseWriteFallbackMode: 'today-daily-note',/);
  assert.match(constantsSource, /tpsBaseWriteFallbackPath: '',/);
  assert.match(mainSource, /this\.settings\.tpsBaseWriteFallbackMode = normalizeTpsBaseWriteFallbackMode\(this\.settings\.tpsBaseWriteFallbackMode\);/);
  assert.match(mainSource, /this\.settings\.tpsBaseWriteFallbackPath = normalizeTpsBaseWriteNotePath\(this\.settings\.tpsBaseWriteFallbackPath\) \|\| '';/);

  assert.match(tasksSource, /setName\('When a Base has no write target'\)/);
  assert.match(tasksSource, /\.addOption\('filter-required', 'Require a file\.path\/task\.path filter'\)/);
  assert.match(tasksSource, /\.addOption\('today-daily-note', 'Today’s Daily Note'\)/);
  assert.match(tasksSource, /\.addOption\('specific-note', 'Specific note'\)/);
  assert.match(tasksSource, /\.setValue\(this\.plugin\.settings\.tpsBaseWriteFallbackMode\)/);
  assert.match(
    tasksSource,
    /this\.plugin\.settings\.tpsBaseWriteFallbackMode = value;\s*await this\.plugin\.saveSettings\(\);\s*this\.redisplayPreservingRouteFocus\('tasks'\);/,
  );

  assert.match(tasksSource, /if \(this\.plugin\.settings\.tpsBaseWriteFallbackMode === 'specific-note'\)/);
  assert.match(tasksSource, /setName\('Fallback write note'\)/);
  assert.match(tasksSource, /\.setValue\(this\.plugin\.settings\.tpsBaseWriteFallbackPath\)/);
  assert.match(
    tasksSource,
    /this\.plugin\.settings\.tpsBaseWriteFallbackPath = value\.trim\(\);\s*await this\.plugin\.saveSettings\(\);/,
  );
  assert.match(tasksSource, /new FileSuggestModal\(this\.app,[\s\S]*\{ extensions: \['md'\] \}\)\.open\(\)/);
  assert.match(
    tasksSource,
    /this\.plugin\.settings\.tpsBaseWriteFallbackPath = file\.path;\s*await this\.plugin\.saveSettings\(\);\s*this\.redisplayPreservingRouteFocus\('tasks'\);/,
  );
  assert.doesNotMatch(
    tasksSource,
    /tpsBaseWriteFallbackPath\s*=\s*''/,
    'switching away from Specific note must not erase the saved path',
  );
});

test('Create task defaults to a configurable standalone parent mode', async () => {
  const tasksStart = settingsTabSource.indexOf("if (this.activeWorkflowPage === 'tasks')");
  const tasksEnd = settingsTabSource.indexOf("if (this.activeWorkflowPage === 'child-notes')", tasksStart);
  const tasksSource = settingsTabSource.slice(tasksStart, tasksEnd);
  const { normalizeCreateTaskDefaultParentMode } = await importModule('../src/utils/create-task-default-parent.ts');

  assert.equal(normalizeCreateTaskDefaultParentMode('standalone'), 'standalone');
  assert.equal(normalizeCreateTaskDefaultParentMode('today-daily-note'), 'today-daily-note');
  assert.equal(normalizeCreateTaskDefaultParentMode('unexpected'), 'standalone');
  assert.equal(normalizeCreateTaskDefaultParentMode(null), 'standalone');

  assert.match(typesSource, /export type CreateTaskDefaultParentMode = 'standalone' \| 'today-daily-note';/);
  assert.match(typesSource, /createTaskDefaultParentMode: CreateTaskDefaultParentMode;/);
  assert.match(constantsSource, /createTaskDefaultParentMode: 'standalone',/);
  assert.match(mainSource, /this\.settings\.createTaskDefaultParentMode = normalizeCreateTaskDefaultParentMode\(/);
  assert.match(mainSource, /needsCreateTaskDefaultParentMigration/);
  assert.match(mainSource, /migration:create-task-default-parent/);
  assert.equal(
    (mainSource.match(/this\.settings\.createTaskDefaultParentMode = normalizeCreateTaskDefaultParentMode\(/g) || []).length,
    2,
    'load and save both normalize the setting',
  );

  const parentSettingIndex = tasksSource.indexOf("setName('Create task default parent')");
  const baseFallbackIndex = tasksSource.indexOf("setName('When a Base has no write target')");
  assert.ok(parentSettingIndex >= 0 && parentSettingIndex < baseFallbackIndex, 'the command default is the first Tasks workflow control');
  assert.match(tasksSource, /Create task note starts standalone or adds a stable link in today’s Daily Note/);
  assert.match(tasksSource, /Legacy checkbox tasks still require a destination note/);
  assert.match(tasksSource, /addOption\('standalone', 'Standalone \(no parent\)'\)/);
  assert.match(tasksSource, /addOption\('today-daily-note', 'Today’s Daily Note'\)/);
  assert.match(tasksSource, /setValue\(this\.plugin\.settings\.createTaskDefaultParentMode\)/);
  assert.match(tasksSource, /createTaskDefaultParentMode = normalizeCreateTaskDefaultParentMode\(value\);\s*await this\.plugin\.saveSettings\(\);/);
  assert.match(tasksSource, /setAttribute\('aria-label', 'Create task default parent'\)/);
});

test('parent link format and notebook navigator smart sort sanitize to one canonical shape', async () => {
  const { sanitizeNotebookNavigatorRuleSettings } = await importModule('../src/services/notebook-navigator-rule-settings.ts');

  assert.match(parentLinkFormatSource, /return value === 'markdown-title' \? 'markdown-title' : 'wikilink';/);
  assert.match(mainSource, /this\.settings\.parentLinkFormat = normalizeParentLinkFormat\(this\.settings\.parentLinkFormat\);/);
  assert.match(settingsTabSource, /\.setValue\(normalizeParentLinkFormat\(this\.plugin\.settings\.parentLinkFormat\)\)/);

  const sanitizedFromLegacyArray = sanitizeNotebookNavigatorRuleSettings({
    smartSort: [
      {
        id: 'bucket-a',
        enabled: true,
        name: 'By priority',
        match: 'all',
        conditions: [],
        sortCriteria: [{ source: 'frontmatter', field: 'priority', type: 'priority', direction: 'asc', mappings: [] }],
      },
    ],
  });
  assert.deepEqual(sanitizedFromLegacyArray.smartSort.buckets.map((bucket) => bucket.id), ['bucket-a']);

  const sanitizedFromLegacySegments = sanitizeNotebookNavigatorRuleSettings({
    smartSort: {
      segments: [
        {
          id: 'seg-1',
          enabled: true,
          source: 'frontmatter',
          field: 'status',
          fallback: '',
          mappings: [],
          match: 'all',
          conditions: [],
        },
      ],
    },
  });
  assert.equal(sanitizedFromLegacySegments.smartSort.buckets.length, 1);
  assert.equal(sanitizedFromLegacySegments.smartSort.buckets[0].id, 'seg-1');
  assert.equal(sanitizedFromLegacySegments.smartSort.buckets[0].sortCriteria[0].field, 'status');
});

test('obsolete type-profile settings are stripped without removing record or folder contracts', () => {
  const obsoleteKeys = [
    'enableTypeProfiles',
    'autoCreateTypeTemplates',
    'typeTemplateFolderPath',
    'typeTemplateIgnoreFolders',
    'typeSystemLimits',
    'defaultSubtypePropertyKey',
    'subtypeTemplateTag',
  ];

  for (const key of obsoleteKeys) {
    assert.doesNotMatch(typesSource, new RegExp(`\\b${key}\\b`));
    assert.doesNotMatch(constantsSource, new RegExp(`\\b${key}\\b`));
    assert.doesNotMatch(settingsTabSource, new RegExp(`\\b${key}\\b`));
    assert.match(mainSource, new RegExp(`delete record\\.${key};`));
  }

  assert.match(mainSource, /this\.stripLegacySettingsFields\(this\.settings as unknown as Record<string, unknown>\);/);
  assert.match(mainSource, /async saveSettings\(\): Promise<void> \{[\s\S]*this\.stripLegacySettingsFields\(this\.settings as unknown as Record<string, unknown>\);/);
  assert.match(typesSource, /TpsRecordKind = [^;]*'log'[^;]*'run'/);
  assert.match(typesSource, /WorkflowRunType = ExtensibleLiteral<'workflow' \| 'workout'>/);
  assert.match(constantsSource, /\{ id: 'type', label: 'Folder', key: 'folderPath', type: 'folder'/);
});

test('retired bundled properties migrate once without rewriting saved Home actions', () => {
  assert.match(mainSource, /const normalizedProperties = this\.normalizeCustomProperties\(this\.settings\.properties\);/);
  assert.match(mainSource, /this\.settings\.properties = this\.removeRetiredBundledCustomProperties\(normalizedProperties\);/);
  assert.match(mainSource, /!id\.startsWith\('tps-health-'\) && !LEGACY_HEALTH_CUSTOM_PROPERTY_IDS\.has\(id\)/);
  assert.match(mainSource, /const needsSettingsMigration =[\s\S]{0,320}removedRetiredPropertyCount > 0;/);
  assert.match(mainSource, /needsSettingsMigration[\s\S]{0,180}preNormalizationSettings[\s\S]{0,180}if \(needsSettingsMigration\) await this\.persistSettingsSnapshot\(\);/);
  assert.match(mainSource, /migration:removed-retired-bundled-properties'[\s\S]{0,120}count: removedRetiredPropertyCount/);
  assert.match(mainSource, /this\.settings\.homeComponentActions = normalizeHomeComponentActions\(this\.settings\.homeComponentActions\);/);
  assert.doesNotMatch(mainSource, /const activityActions = this\.settings\.homeComponentActions/);
  assert.doesNotMatch(mainSource, /this\.settings\.homeComponentActions\['workout-tracker'\]\s*=/);
});

test('optional inline and context surfaces default to the lean off state', () => {
  for (const key of [
    'enableInlinePersistentMenus',
    'enableInLivePreview',
    'enableInPreview',
    'enableInSidePanels',
    'showCustomPropertiesInInlineUi',
    'showCustomPropertiesInContextMenu',
    'inheritNotebookNavigatorTagColors',
    'enableTimeTracking',
  ]) {
    assert.match(constantsSource, new RegExp(`${key}: false`));
  }
  assert.match(typesSource, /DEFAULT_NOTEBOOK_NAVIGATOR_RULE_SETTINGS[\s\S]{0,120}enabled: false,[\s\S]{0,80}autoApplyOnFileOpen: false/);
  assert.match(constantsSource, /homeComponents:\s*\[\s*\{ type: 'base', path: HOME_DAILY_NOTE_FEED_BASE_PATH \},\s*'calendar',\s*'open-unscheduled-tasks',\s*\]/);
  assert.doesNotMatch(constantsSource, /commandId: 'tps-health:/);
  assert.match(mainSource, /this\.settings = Object\.assign\(\{\}, DEFAULT_SETTINGS, loaded \?\? \{\}\);/);
});

test('time tracking normalizes a clean Daily Note workspace default', () => {
  assert.match(constantsSource, /timeTrackingDailyNoteHeading: 'Time Tracking'/);
  assert.match(constantsSource, /timeTrackingDailyNotePlacement: 'top'/);
  assert.match(
    mainSource,
    /timeTrackingDailyNoteHeading[\s\S]{0,320}replace\(\/\[\\r\\n\]\+\/g, ' '\)[\s\S]{0,220}timeTrackingDailyNotePlacement === 'bottom' \? 'bottom' : 'top'/,
  );
});

test('icon and color rule filter matches exact case-insensitive working values deterministically', async () => {
  const { matchesRuleFilter, collectRuleFilterTerms } = await importModule('../src/notebook-navigator-settings/rule-filter.ts');

  const advancedRule = {
    id: 'rule-working',
    name: 'Status working',
    enabled: true,
    property: '',
    operator: 'is',
    value: '',
    pathPrefix: '',
    icon: 'lucide:clipboard-list',
    color: '#4caf50',
    match: 'all',
    conditions: [
      { source: 'frontmatter', field: 'status', operator: 'is', value: 'working' },
    ],
  };

  const terms = collectRuleFilterTerms(advancedRule, 1).map((term) => term.toLowerCase());
  assert.ok(terms.includes('working'));
  assert.equal(matchesRuleFilter(advancedRule, 1, 'working'), true);
  assert.equal(matchesRuleFilter(advancedRule, 1, 'Working'), true);
  assert.equal(matchesRuleFilter(advancedRule, 1, 'lucide:clipboard-list'), true);
  assert.equal(matchesRuleFilter(advancedRule, 1, 'nonexistent'), false);
});

test('Notebook Navigator rules expose checkbox state as a first-class source', async () => {
  const { sanitizeNotebookNavigatorRuleSettings } = await importModule('../src/services/notebook-navigator-rule-settings.ts');

  const sanitized = sanitizeNotebookNavigatorRuleSettings({
    rules: [{
      id: 'checkbox-rule',
      enabled: true,
      match: 'all',
      conditions: [{ source: 'checkbox-state', field: 'status', operator: 'is', value: 'open' }],
    }],
    hideRules: [{
      id: 'hide-open-checkbox',
      enabled: true,
      mode: 'add',
      tagName: 'hide',
      match: 'all',
      conditions: [{ source: 'checkbox-state', field: 'status', operator: '!is', value: 'x' }],
    }],
    smartSort: {
      buckets: [{
        id: 'bucket-checkbox',
        enabled: true,
        name: 'Checkboxes',
        match: 'all',
        conditions: [{ source: 'checkbox-state', field: 'status', operator: 'contains', value: '-' }],
        sortCriteria: [{ source: 'checkbox-state', field: 'status', type: 'status', direction: 'asc', mappings: [{ input: 'open', output: '001' }] }],
      }],
    },
  });

  assert.equal(sanitized.rules[0].conditions[0].source, 'checkbox-state');
  assert.equal(sanitized.rules[0].conditions[0].field, 'status');
  assert.equal(sanitized.hideRules[0].conditions[0].source, 'checkbox-state');
  assert.equal(sanitized.smartSort.buckets[0].conditions[0].source, 'checkbox-state');
  assert.equal(sanitized.smartSort.buckets[0].sortCriteria[0].source, 'checkbox-state');

  assert.match(notebookRuleServiceSource, /checkboxStates: this\.collectCheckboxStates\(body\)/);
  assert.match(notebookRuleServiceSource, /states\.add\(marker \|\| 'open'\)/);
  assert.match(notebookRuleEngineSource, /if \(source === "checkbox-state"\)/);
  assert.match(notebookRuleEngineSource, /context\.checkboxStates/);
  assert.match(notebookRuleEngineSource, /states\.add\(marker \|\| "open"\)/);
  assert.match(notebookRuleSettingsSource, /value === 'checkbox-state'/);
  assert.match(notebookUiCommonSource, /\{ value: "checkbox-state", label: "Checkbox state" \}/);
  assert.match(notebookUiCommonSource, /conditionSourceHasField/);
  assert.match(notebookUiCommonSource, /smartOperatorNeedsValue/);
  assert.match(notebookUiCommonSource, /open, x, -, \//);
  assert.match(notebookOperatorsSource, /source === "checkbox-state"[\s\S]*"is", "!is"[\s\S]*"exists", "!exists"/);
  assert.match(notebookRulesSectionSource, /conditionSourceHasField\(liveCondition\.source\)/);
  assert.match(notebookHideSectionSource, /conditionSourceHasField\(liveCondition\.source\)/);
  assert.match(notebookBucketSectionSource, /criterion\.source === "checkbox-state"/);
  assert.doesNotMatch(notebookRuleEngineSource, /checkbox-state[\s\S]{0,800}linkedSubitem|checkbox-state[\s\S]{0,800}mapping/i);
});

test('recurrence and daily note child settings are hidden immediately when parent toggles turn off', () => {
  assert.match(settingsTabSource, /enableRecurrence = v; await this\.plugin\.saveSettings\(\); this\.display\(\);/);
  assert.match(settingsTabSource, /if \(this\.plugin\.settings\.enableDailyNoteNav\) \{/);
  assert.match(settingsTabSource, /enableDailyNoteNav = v;\s*await this\.plugin\.saveSettings\(\);\s*this\.display\(\);/);
});

test('settings use shallow routed pages with responsive, accessible selectors', () => {
  const hubStart = settingsTabSource.indexOf('private renderSettingsHub');
  const hubEnd = settingsTabSource.indexOf('private renderRulesFieldsNavigation', hubStart);
  const hubSource = settingsTabSource.slice(hubStart, hubEnd);
  assert.match(hubSource, /Choose what to configure/);
  for (const route of ['rules-fields', 'menus-surfaces', 'workflows', 'appearance', 'advanced']) {
    assert.match(hubSource, new RegExp(`id: '${route}'`));
  }
  assert.match(hubSource, /Right-click placement, linked context, note navigation, and inline UI\./);
  assert.equal((hubSource.match(/\bid: '/g) || []).length, 5);
  assert.match(settingsTabSource, /private activeSettingsPage: SettingsPageId = 'rules-fields';/);
  assert.match(settingsTabSource, /private activeRulesFieldsPage: RulesFieldsPageId = 'frontmatter';/);
  assert.match(settingsTabSource, /private activeFrontmatterEditor: FrontmatterEditorId = 'sort';/);
  for (const transientKey of [
    'activeSettingsPage',
    'activeRulesFieldsPage',
    'activeFrontmatterEditor',
    'activeWorkflowPage',
    'activeBaseQuerySection',
  ]) {
    assert.doesNotMatch(typesSource, new RegExp(`\\b${transientKey}\\b`));
    assert.doesNotMatch(constantsSource, new RegExp(`\\b${transientKey}\\b`));
  }

  const routeButtonsStart = settingsTabSource.indexOf('private renderRouteButtons');
  const routeButtonsEnd = settingsTabSource.indexOf('private renderSettingsHub', routeButtonsStart);
  const routeButtonsSource = settingsTabSource.slice(routeButtonsStart, routeButtonsEnd);
  assert.match(routeButtonsSource, /createEl\('button'/);
  assert.match(routeButtonsSource, /button\.type = 'button'/);
  assert.match(routeButtonsSource, /setAttr\('aria-pressed'/);
  assert.match(routeButtonsSource, /option\.id === activeId/);
  assert.match(settingsTabSource, /private navigateToSettingsPage[\s\S]*focus\(\{ preventScroll: false \}\)/);
  assert.match(settingsTabSource, /private redisplayPreservingRouteFocus[\s\S]*focusRouteButton\(route\)/);
  assert.match(settingsTabSource, /private focusRouteButton[\s\S]*focus\(\{ preventScroll: true \}\)/);
  assert.match(settingsTabSource, /heading\.setAttr\('tabindex', '-1'\)/);

  const displayStart = settingsTabSource.indexOf('display(): void');
  const displayEnd = settingsTabSource.indexOf('\n  renderProperties(container:', displayStart);
  const displaySource = settingsTabSource.slice(displayStart, displayEnd);
  assert.match(displaySource, /const activePage = this\.activeSettingsPage === 'rules-fields'/);
  assert.match(displaySource, /this\.renderRulesFieldsNavigation\(activePage\)/);
  assert.match(displaySource, /this\.renderWorkflowNavigation\(automation\)/);
  assert.doesNotMatch(displaySource, /createCollapsibleSection\(containerEl/);
  assert.doesNotMatch(displaySource, /createTrackedSection\(containerEl/);
  assert.doesNotMatch(displaySource, /containerEl\.createEl\('details'/);

  const frontmatterStart = settingsTabSource.indexOf('private renderNotebookNavigatorRules');
  const frontmatterEnd = settingsTabSource.indexOf('private renderRuleOverviewCard', frontmatterStart);
  const frontmatterSource = settingsTabSource.slice(frontmatterStart, frontmatterEnd);
  assert.match(frontmatterSource, /id: 'sort', label: 'Virtual sort'/);
  assert.match(frontmatterSource, /id: 'tags', label: 'Semantic tags'/);
  assert.match(frontmatterSource, /id: 'icon-color', label: 'Icon \+ color'/);
  assert.match(frontmatterSource, /if \(this\.activeFrontmatterEditor === 'sort'\)/);
  assert.equal((frontmatterSource.match(/this\.createTrackedSection\(/g) || []).length, 1);
  assert.match(frontmatterSource, /'Automation and safeguards'/);

  for (const workflow of ['home-daily', 'tasks', 'child-notes', 'recurrence', 'time-tracking']) {
    assert.match(settingsTabSource, new RegExp(`id: '${workflow}', label:`));
    assert.match(displaySource, new RegExp(`this\\.activeWorkflowPage === '${workflow}'`));
  }
  assert.match(displaySource, /this\.activeRulesFieldsPage === 'custom-fields'[\s\S]*showCustomPropertiesInInlineUi[\s\S]*this\.renderProperties\(propertiesConfigContainer\)/);
  assert.match(displaySource, /this\.activeRulesFieldsPage === 'view-mode'[\s\S]*enableViewModeSwitching[\s\S]*viewModeRules/);

  assert.match(stylesSource, /\.tps-gcm-settings-hub\s*\{[\s\S]*position: sticky;[\s\S]*grid-template-columns:/);
  assert.match(stylesSource, /\.tps-gcm-settings-route-button\[aria-pressed='true'\]/);
  assert.match(stylesSource, /\.tps-gcm-settings-route-button\s*\{[\s\S]*\n  height: auto;/);
  assert.match(stylesSource, /@media \(max-width: 700px\)[\s\S]*\.tps-gcm-settings-hub[\s\S]*display: flex/);
  assert.match(stylesSource, /@media \(max-width: 700px\)[\s\S]*\.tps-gcm-settings-subnav/);
  assert.match(stylesSource, /\.tps-gcm-viewmode-condition-row\s*\{[\s\S]*grid-template-columns:/);
  assert.match(stylesSource, /@media \(max-width: 700px\)[\s\S]*\.tps-gcm-viewmode-condition-row[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(stylesSource, /(?:^|\n)\.tps-settings-(?:hub|subnav|route|page|editor|callout)/);
});

test('TPS Home settings keep Base ownership in Home edit mode and expose the Daily Note toggle', () => {
  assert.match(mainSource, /homeCalendarBasePath =\s*typeof this\.settings\.homeCalendarBasePath === 'string'/);
  assert.doesNotMatch(settingsTabSource, /setName\('Home (?:calendar|food|activity|open tasks) Base path'\)/);
  assert.match(constantsSource, /enableDailyNoteHome:\s*true/);
  assert.match(mainSource, /this\.settings\.enableDailyNoteHome = this\.settings\.enableDailyNoteHome !== false/);
  assert.match(mainSource, /AUTHORITATIVE_HOME_SETTING_KEYS[\s\S]*'homeOpenTasksBasePath'/);
  assert.match(mainSource, /if \(!Object\.prototype\.hasOwnProperty\.call\(loadedSettingsRecord, key\)\) \{\s*delete preNormalizationSettings\[key\]/);
  assert.match(mainSource, /normalizedAuthoritativeHomeSettingKeys\.length > 0/);
  assert.match(mainSource, /migration:authoritative-home-settings/);
  assert.match(settingsTabSource, /setName\('Use TPS Home for Daily Notes'\)/);
  assert.match(settingsTabSource, /runDailyNoteHomeSettingTransaction\(\{/);
  assert.match(settingsTabSource, /const generation = \+\+this\.dailyNoteHomeToggleGeneration/);
  assert.match(settingsTabSource, /const previousValue = this\.plugin\.settings\.enableDailyNoteHome !== false/);
  assert.match(settingsTabSource, /applyEnabled: \(enabled\) => service\?\.setEnabled\(enabled\)/);
  assert.match(settingsTabSource, /setSetting: \(enabled\) => \{\s*this\.plugin\.settings\.enableDailyNoteHome = enabled/);
  assert.match(settingsTabSource, /isCurrent: \(\) => generation === this\.dailyNoteHomeToggleGeneration/);
  assert.match(settingsTabSource, /isAvailable: \(\) => service\?\.isAvailable\(\) \?\? true/);
  assert.match(settingsTabSource, /toggle\.setValue\(result\.effectiveValue\)/);
  assert.doesNotMatch(settingsTabSource, /if \(value === previous\) return/);
  assert.match(mainSource, /homeCaptureInsertPosition === 'top' \? 'top' : 'bottom'/);
  assert.match(mainSource, /delete record\.homeCaptureAddHeading/);
  assert.match(mainSource, /delete record\.homeCaptureHeading/);
  assert.doesNotMatch(typesSource, /homeCaptureAddHeading|homeCaptureHeading/);
  assert.match(mainSource, /homeComponentLayouts = this\.normalizeHomeComponentLayouts\(this\.settings\.homeComponentLayouts\)/);
  assert.match(mainSource, /private normalizeHomeComponentLayouts\(value: unknown\)/);
  assert.match(mainSource, /this\.normalizeHomeLayoutNumber\(source\.height, 220, 1200\)/);
  assert.match(mainSource, /this\.normalizeHomeLayoutNumber\(source\.capturePreviewHeight, 120, 900\)/);
  assert.match(settingsTabSource, /setName\('Home capture position'\)/);
  assert.match(settingsTabSource, /\.addOption\('bottom', 'Bottom of note'\)/);
  assert.doesNotMatch(settingsTabSource, /setName\('Home capture heading'\)/);
});

test('archive action uses Controller two-stage source folder and moves files immediately', () => {
  assert.match(mainSource, /settings\?\.twoStageArchive && typeof settings\.twoStageArchive\.sourceFolder === 'string'/);
  assert.match(mainSource, /return sourceFolder\.trim\(\);/);
  assert.match(mainSource, /const resolved = controller \|\| configured \|\| legacy;/);
  assert.match(mainSource, /this\.archiveFileService = new ArchiveFileService\(this\);/);
  assert.match(panelBuilderSource, /this\.plugin\.archiveFileService\.archiveFiles\(files, 'persistent-panel'\)/);
  assert.match(menuBuilderSource, /this\.plugin\.archiveFileService\.archiveFiles\(files, 'native-context-menu'\)/);
  assert.match(menuBuilderSource, /this\.plugin\.archiveFileService\.unarchiveFiles\(files, 'native-context-menu'\)/);
  assert.match(archiveFileServiceSource, /if \(!archiveFolder\)/);
  assert.match(archiveFileServiceSource, /liveFile\.extension\?\.toLowerCase\(\) === 'md' && archiveTag/);
  assert.match(archiveFileServiceSource, /frontmatter\.archiveOriginalFolder = originalFolder;/);
  assert.match(archiveFileServiceSource, /Archive metadata write failed; continuing with immediate move/);
  assert.match(archiveFileServiceSource, /await this\.plugin\.app\.fileManager\.renameFile\(liveFile, targetPath\);/);

  const nativeArchiveStart = menuBuilderSource.indexOf('private async archiveFiles');
  const nativeArchiveEnd = menuBuilderSource.indexOf('private async unarchiveFiles', nativeArchiveStart);
  const nativeArchiveSource = menuBuilderSource.slice(nativeArchiveStart, nativeArchiveEnd);
  assert.doesNotMatch(nativeArchiveSource, /Tagged .* for archive|Archive tag setting is not configured/);
  assert.doesNotMatch(nativeArchiveSource, /extension\?\.toLowerCase\(\) !== 'md'/);

  const unarchiveStart = archiveFileServiceSource.indexOf('async unarchiveFiles');
  const unarchiveEnd = archiveFileServiceSource.indexOf('private getUniqueFiles', unarchiveStart);
  const unarchiveSource = archiveFileServiceSource.slice(unarchiveStart, unarchiveEnd);
  assert.ok(
    unarchiveSource.indexOf('fileManager.renameFile') < unarchiveSource.indexOf('frontmatterMutationService.process'),
    'unarchive must move successfully before removing restore metadata',
  );
});

test('create-time title sync does not inject titles into blank new notes', () => {
  assert.match(registerEventsSource, /onlyIfMissing: true,/);
  assert.match(registerEventsSource, /onlyIfHasFrontmatter: true,/);
  assert.match(registerEventsSource, /applyRulesToFile\(liveFile, \{\s*reason: 'create',\s*force: true,\s*bypassCreationGrace: true,/);
  assert.match(registerEventsSource, /\}, 3800\);/);
  assert.match(notebookRuleServiceSource, /removeGeneratedBlankNoteTitle\(file, frontmatter, body, options\)/);
  assert.match(notebookRuleServiceSource, /if \(options\.reason !== 'create'\) return;/);
  assert.match(notebookRuleServiceSource, /deleteValueCaseInsensitive\(frontmatter, 'title'\);/);
  assert.match(fileNamingServiceSource, /isBlankGeneratedUntitledNote\(liveFile, rawBasename\)/);
  assert.match(fileNamingServiceSource, /\^Untitled/);
  assert.match(fileNamingServiceSource, /body\.trim\(\)\.length === 0/);
});

test('frontmatter-rule settings CSS stays GCM-owned and cannot style Notebook Navigator', () => {
  const frontmatterRuleSources = [
    settingsTabSource,
    notebookRulesSectionSource,
    notebookBucketSectionSource,
    notebookHideSectionSource,
  ];

  for (const source of frontmatterRuleSources) {
    assert.doesNotMatch(source, /tps-nn-/u);
  }
  assert.doesNotMatch(settingsTabSource, /tps-base-query-/u);
  assert.doesNotMatch(stylesSource, /tps-nn-|tps-base-query-/u);
  assert.doesNotMatch(settingsTabSource, /ensureNotebookNavigatorSettingsStyles|document\.head\.appendChild\(style\)/u);

  assert.match(settingsTabSource, /tps-gcm-settings-frontmatter-rules-overview-grid/u);
  assert.match(notebookRulesSectionSource, /tps-gcm-settings-frontmatter-rules-list-pane/u);
  assert.match(notebookBucketSectionSource, /tps-gcm-settings-frontmatter-rules-sort-buckets/u);
  assert.match(notebookHideSectionSource, /tps-gcm-settings-frontmatter-rules-tag-rules/u);
  assert.match(settingsTabSource, /tps-gcm-settings-base-query-reference/u);
  assert.match(settingsTabSource, /dataset\.tpsGcmSettingsBaseQueryCategory = 'true'/u);
  assert.match(settingsTabSource, /\[data-tps-gcm-settings-base-query-category="true"\]/u);

  assert.match(
    stylesSource,
    /\.tps-gcm-settings-editor-page \.tps-gcm-settings-frontmatter-rules-list-pane\s*\{/u,
  );
  assert.match(
    stylesSource,
    /@media \(max-width: 900px\)[\s\S]*\.tps-gcm-settings-editor-page \.tps-gcm-settings-frontmatter-rules-list-pane/u,
  );
  assert.match(
    stylesSource,
    /\.tps-gcm-settings-page \.tps-gcm-settings-base-query-reference/u,
  );

  assert.match(
    mainSource,
    /removeLegacyNotebookNavigatorRuleSettingsStyles\(\);[\s\S]*workspace\.on\('window-open', \(_workspaceWindow, targetWindow\)/u,
  );
  assert.match(
    mainSource,
    /iterateAllLeaves\(\(leaf\) => \{\s*ownerDocuments\.add\(leaf\.getContainer\(\)\.doc\);/u,
  );
  assert.match(
    settingsTabSource,
    /LEGACY_GCM_NOTEBOOK_NAVIGATOR_RULE_SETTINGS_STYLE_ID/u,
  );
});
