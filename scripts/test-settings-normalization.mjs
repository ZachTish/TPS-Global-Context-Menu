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

test('linked subitem mapping presentation fields survive textarea-style parse results', async () => {
  const { mergeLinkedSubitemMappingPresentation } = await importModule('../src/utils/linked-subitem-mapping.ts');

  const parsed = [
    { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete' },
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[custom]', statuses: ['waiting'], toggleTargetStatus: 'todo' },
  ];
  const existing = [
    { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete', icon: 'square', label: 'Todo' },
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo', icon: 'check', label: 'Complete' },
  ];

  assert.deepEqual(mergeLinkedSubitemMappingPresentation(parsed, existing), [
    { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete', icon: 'square', label: 'Todo' },
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo', icon: 'check', label: 'Complete' },
    { checkboxState: '[custom]', statuses: ['waiting'], toggleTargetStatus: 'todo', icon: undefined, label: undefined },
  ]);
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
  assert.match(mainSource, /const needsSettingsMigration =[\s\S]{0,180}removedRetiredPropertyCount > 0;/);
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
  const frontmatterEnd = settingsTabSource.indexOf('private ensureNotebookNavigatorSettingsStyles', frontmatterStart);
  const frontmatterSource = settingsTabSource.slice(frontmatterStart, frontmatterEnd);
  assert.match(frontmatterSource, /id: 'sort', label: 'Sort buckets'/);
  assert.match(frontmatterSource, /id: 'tags', label: 'Tag rules'/);
  assert.match(frontmatterSource, /id: 'icon-color', label: 'Icon \+ color'/);
  assert.match(frontmatterSource, /if \(this\.activeFrontmatterEditor === 'sort'\)/);
  assert.equal((frontmatterSource.match(/this\.createTrackedSection\(/g) || []).length, 1);
  assert.match(frontmatterSource, /'Advanced rule settings'/);

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

test('TPS Home capture settings expose plain-line insertion defaults and retire heading routing', () => {
  assert.match(mainSource, /homeCalendarBasePath =\s*typeof this\.settings\.homeCalendarBasePath === 'string'/);
  assert.match(settingsTabSource, /setName\('Home calendar Base path'\)/);
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
  assert.match(panelBuilderSource, /const archiveFolder = this\.plugin\.getArchiveFolderPath\(\);/);
  assert.match(panelBuilderSource, /await this\.ensureFolderPath\(archiveFolder\);/);
  assert.match(panelBuilderSource, /liveFile\.extension\?\.toLowerCase\(\) === 'md' && archiveTag/);
  assert.match(panelBuilderSource, /frontmatter\.archiveOriginalFolder = originalFolder;/);
  assert.match(panelBuilderSource, /await this\.app\.fileManager\.renameFile\(liveFile, targetPath\);/);
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
