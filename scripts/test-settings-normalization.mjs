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
  assert.match(mainSource, /hadRetiredHomeCaptureHeadingSettings \|\| needsActivityBasePathMigration \|\| removedRetiredPropertyCount > 0[\s\S]{0,100}await this\.saveData\(this\.settings\)/);
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
