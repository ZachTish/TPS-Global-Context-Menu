import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function importBundled(relativePath) {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

const propertiesPromise = importBundled('../src/services/task-editor-properties.ts');
const metadataPromise = importBundled('../src/utils/task-line-metadata.ts');

function property(key, type, overrides = {}) {
  return {
    id: key,
    key,
    label: key,
    type,
    ...overrides,
  };
}

test('existing inline properties retain source order and resolve type-appropriate editor descriptors', async () => {
  const { collectTaskEditorProperties } = await propertiesPromise;
  const line = [
    '- [ ] Validate task editor',
    '[unconfigured:: plain]',
    '[estimate:: 004.50]',
    '[due:: 2026-07-22 09:30:00]',
    '[category:: work]',
    '[tags:: alpha, beta]',
    '[confirmed:: false]',
    '[recurrence:: every week]',
  ].join(' ');
  const descriptors = collectTaskEditorProperties(line, [
    property('estimate', 'number', { label: 'Estimate' }),
    property('due', 'datetime', { label: 'Due date' }),
    property('category', 'selector', { label: 'Category', options: ['work', 'home'] }),
    property('tags', 'list', { label: 'Tags' }),
    property('recurrence', 'recurrence', { label: 'Repeat' }),
  ]);

  assert.deepEqual(
    descriptors.map(({ key, label, type, value }) => ({ key, label, type, value })),
    [
      { key: 'unconfigured', label: 'unconfigured', type: 'text', value: 'plain' },
      { key: 'estimate', label: 'Estimate', type: 'number', value: '004.50' },
      { key: 'due', label: 'Due date', type: 'datetime', value: '2026-07-22 09:30:00' },
      { key: 'category', label: 'Category', type: 'selector', value: 'work' },
      { key: 'tags', label: 'Tags', type: 'list', value: 'alpha, beta' },
      { key: 'confirmed', label: 'confirmed', type: 'checkbox', value: 'false' },
      { key: 'recurrence', label: 'Repeat', type: 'recurrence', value: 'every week' },
    ],
  );

  const duplicateKeys = collectTaskEditorProperties(
    '- [ ] Keep first casing and value [Priority:: high] [priority:: low] [Custom:: one]',
  );
  assert.deepEqual(
    duplicateKeys.map(({ key, value }) => ({ key, value })),
    [
      { key: 'Priority', value: 'high' },
      { key: 'Custom', value: 'one' },
    ],
  );
});

test('task-editor descriptors exclude status, hidden/system fields, and configured timestamp carriers', async () => {
  const { collectTaskEditorProperties } = await propertiesPromise;
  const line = [
    '- [ ] Protected metadata stays out of the editor',
    '[status:: working]',
    '[title:: hidden title]',
    '[parent:: hidden parent]',
    '[parentOf:: hidden child]',
    '[folderPath:: Projects]',
    '[tpsId:: item_123]',
    '[subitemId:: child_123]',
    '[tpsInlineProps:: hidden_payload]',
    '[externalEventId:: event_123]',
    '[externalId:: external_123]',
    '[tpsCalendarUid:: calendar_123]',
    '[tpsCalendarSourceUrl:: https://example.test/calendar]',
    '[recurrenceTaskId:: recurrence_123]',
    '[migratedTo:: Archive]',
    '[associatedNotePath:: Notes/Target.md]',
    '[stableId:: stable_123]',
    '[completedDate:: 2026-07-21 10:00:00]',
    '[createdCustom:: 2026-07-20 08:00:00]',
    '[modifiedCustom:: 2026-07-21 08:00:00]',
    '[hiddenField:: secret]',
    '[disabledField:: disabled]',
    '[neverField:: never]',
    '[folderField:: Projects]',
    '[snoozeField:: tomorrow]',
    '[existingOnly:: editable]',
    '[visible:: yes]',
  ].join(' ');
  const descriptors = collectTaskEditorProperties(
    line,
    [
      property('hiddenField', 'text', { hidden: true }),
      property('disabledField', 'text', { disabled: true }),
      property('neverField', 'text', { showWhen: 'never' }),
      property('folderField', 'folder'),
      property('snoozeField', 'snooze'),
      property('existingOnly', 'text', { allowInlineSet: false }),
      property('visible', 'text'),
    ],
    'status',
    ['createdCustom', 'modifiedCustom'],
  );

  assert.deepEqual(
    descriptors.map(({ key }) => key),
    ['existingOnly', 'visible'],
    'allowInlineSet governs insertion, not editing a field that is already present',
  );
});

test('the scheduled editor owns its existing time-estimate and all-day companion fields', async () => {
  const { collectTaskEditorProperties } = await propertiesPromise;
  const line = '- [ ] Schedule me [timeEstimate:: 45] [scheduled:: 2026-07-22 09:30:00] [allDay:: true] [priority:: high]';

  const descriptors = collectTaskEditorProperties(line, [
    property('scheduled', 'datetime', { label: 'Scheduled' }),
    property('timeEstimate', 'number', { label: 'Estimate' }),
    property('allDay', 'checkbox', { label: 'All day' }),
    property('priority', 'selector', { label: 'Priority' }),
  ]);
  assert.deepEqual(
    descriptors.map(({ key, type }) => ({ key, type })),
    [
      { key: 'scheduled', type: 'datetime' },
      { key: 'priority', type: 'selector' },
    ],
  );

  const hiddenScheduled = collectTaskEditorProperties(line, [
    property('scheduled', 'datetime', { hidden: true }),
    property('timeEstimate', 'number'),
    property('allDay', 'checkbox'),
  ]);
  assert.deepEqual(
    hiddenScheduled.map(({ key, type }) => ({ key, type })),
    [
      { key: 'timeEstimate', type: 'number' },
      { key: 'allDay', type: 'checkbox' },
      { key: 'priority', type: 'text' },
    ],
    'hiding the scheduled control must not also make its independently configured companions unreachable',
  );
});

test('editor property values normalize without silently accepting or coercing invalid numbers', async () => {
  const {
    buildTaskEditorPropertyChange,
    isTruthyTaskPropertyValue,
    normalizeTaskEditorPropertyValue,
  } = await propertiesPromise;
  const normalize = (type, value) => normalizeTaskEditorPropertyValue({ type }, value);

  assert.equal(normalize('text', '  keep this  '), 'keep this');
  assert.equal(normalize('datetime', '  2026-07-22 09:30:00  '), '2026-07-22 09:30:00');
  assert.equal(normalize('recurrence', '  every 2 weeks  '), 'every 2 weeks');
  assert.equal(normalize('number', '004.50'), '4.5');
  assert.equal(normalize('number', '-2.25'), '-2.25');
  assert.equal(normalize('number', 'not a number'), 'not a number');
  assert.equal(normalize('number', 'Infinity'), 'Infinity');
  assert.equal(normalize('list', ' Alpha, beta\nalpha, , Gamma, BETA '), 'Alpha, beta, Gamma');
  assert.equal(normalize('checkbox', 'YES'), 'true');
  assert.equal(normalize('checkbox', 'off'), 'false');
  assert.equal(isTruthyTaskPropertyValue('checked'), true);
  assert.equal(isTruthyTaskPropertyValue('0'), false);
  assert.equal(
    buildTaskEditorPropertyChange(
      { key: 'estimate', label: 'Estimate', type: 'number', value: 'Infinity', property: null },
      'Infinity',
      'Infinity',
    ),
    null,
    'an untouched malformed legacy number must not become edit intent during an unrelated save',
  );
  assert.deepEqual(
    buildTaskEditorPropertyChange(
      { key: 'estimate', label: 'Estimate', type: 'number', value: 'Infinity', property: null },
      'Infinity',
      '45',
    ),
    { key: 'estimate', value: '45' },
  );

  const entityCheckbox = property('approval', 'checkbox', {
    acceptsKind: 'status',
    optionSources: ['manual', 'entity'],
  });
  assert.equal(
    normalizeTaskEditorPropertyValue(
      {
        key: 'approval',
        label: 'Approval',
        type: 'checkbox',
        value: '[[Statuses/Approved]]',
        property: entityCheckbox,
      },
      '[[Statuses/Approved]]',
    ),
    '[[Statuses/Approved]]',
    'an entity-enabled checkbox field is a relation editor and must not coerce its link to false',
  );
});

test('generic datetime results cannot mutate scheduled companion drafts', async () => {
  const { applyTaskEditorScheduleResult } = await propertiesPromise;
  const companions = {
    initialTimeEstimate: '45',
    initialAllDay: 'true',
    timeEstimate: '45',
    allDay: 'true',
  };

  assert.equal(
    applyTaskEditorScheduleResult('due', companions, { date: '', timeEstimate: 0, allDay: false }),
    companions,
    'clearing a non-scheduled datetime must leave the scheduled draft untouched',
  );
  assert.deepEqual(
    applyTaskEditorScheduleResult('scheduled', companions, { date: '', timeEstimate: 0, allDay: false }),
    {
      initialTimeEstimate: '45',
      initialAllDay: 'true',
      timeEstimate: '',
      allDay: '',
    },
  );
});

test('no-op saves are byte-identical and explicit edits preserve concurrent task changes', async () => {
  const { applyTaskEditorPropertyChanges } = await propertiesPromise;
  const { getTaskEditableBody, readInlineFieldValue } = await metadataPromise;
  const current = '- [ ] Renamed concurrently #current [priority:: medium] [status:: working] [newRemoteField:: preserve] [tpsId:: item_123] %% tps-inline-props:{"externalId":"remote_123"} %%';

  assert.equal(
    applyTaskEditorPropertyChanges(current, []),
    current,
    'a save with no property intent must not rewrite or reorder any byte',
  );

  const edited = applyTaskEditorPropertyChanges(current, [
    { key: 'priority', value: 'low' },
    { key: 'due', value: '2026-07-23 11:15:00' },
  ]);
  assert.equal(getTaskEditableBody(edited), 'Renamed concurrently #current');
  assert.equal(readInlineFieldValue(edited, 'priority'), 'low');
  assert.equal(readInlineFieldValue(edited, 'due'), '2026-07-23 11:15:00');
  assert.equal(readInlineFieldValue(edited, 'status'), 'working');
  assert.equal(readInlineFieldValue(edited, 'newRemoteField'), 'preserve');
  assert.equal(readInlineFieldValue(edited, 'tpsId'), 'item_123');
  assert.match(edited, /%% tps-inline-props:\{"externalId":"remote_123"\} %%/u);

  const firstIntentWins = applyTaskEditorPropertyChanges(current, [
    { key: 'priority', value: 'high' },
    { key: 'PRIORITY', value: 'low' },
  ]);
  assert.equal(readInlineFieldValue(firstIntentWins, 'priority'), 'high');

  const removed = applyTaskEditorPropertyChanges(edited, [{ key: 'due', value: null }]);
  assert.equal(readInlineFieldValue(removed, 'due'), '');
  assert.equal(readInlineFieldValue(removed, 'newRemoteField'), 'preserve');
});

test('scheduled companion changes apply together while protected metadata cannot be overwritten', async () => {
  const { applyTaskEditorPropertyChanges } = await propertiesPromise;
  const { readInlineFieldValue } = await metadataPromise;
  const current = '- [ ] Schedule bundle [scheduled:: 2026-07-22 09:30:00] [timeEstimate:: 45] [allDay:: false] [tpsId:: keep_me] [parent:: keep_parent]';
  const edited = applyTaskEditorPropertyChanges(current, [
    { key: 'scheduled', value: '2026-07-24 13:00:00' },
    { key: 'timeEstimate', value: '90' },
    { key: 'allDay', value: 'true' },
    { key: 'tpsId', value: 'replace_me' },
    { key: 'parent', value: 'replace_parent' },
  ]);

  assert.equal(readInlineFieldValue(edited, 'scheduled'), '2026-07-24 13:00:00');
  assert.equal(readInlineFieldValue(edited, 'timeEstimate'), '90');
  assert.equal(readInlineFieldValue(edited, 'allDay'), 'true');
  assert.equal(readInlineFieldValue(edited, 'tpsId'), 'keep_me');
  assert.equal(readInlineFieldValue(edited, 'parent'), 'keep_parent');
});

test('quick-editor source keeps property commits atomic and provides mobile-safe property controls', () => {
  const serviceSource = readFileSync(new URL('../src/services/task-line-context-menu-service.ts', import.meta.url), 'utf8');
  const stylesSource = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
  const recurrenceModalSource = readFileSync(new URL('../src/modals/recurrence-modal.ts', import.meta.url), 'utf8');

  assert.match(serviceSource, /collectTaskEditorProperties\(/u);
  assert.match(serviceSource, /applyTaskEditorPropertyChanges\(/u);
  assert.match(serviceSource, /tps-gcm-task-editor-properties/u);
  assert.match(serviceSource, /Number\.isFinite\(/u, 'number fields must be rejected before committing invalid values');
  assert.match(
    serviceSource,
    /updateTaskLine\([\s\S]{0,1000}setTaskEditableBody\([\s\S]{0,1000}applyTaskEditorPropertyChanges\(/u,
    'body and property intents must be committed through one freshly resolved line update',
  );
  assert.match(serviceSource, /changedPropertyKeys/u, 'logs should identify changed keys without logging their values');
  assert.match(serviceSource, /maybePromptMoveScheduledDailyNoteTask\(/u);
  assert.match(serviceSource, /inputmode: descriptor\.type === 'number' \? 'decimal' : 'text'/u);
  assert.match(serviceSource, /\{ showEndsOn: false \}/u);
  assert.match(recurrenceModalSource, /if \(this\.options\.showEndsOn\)/u);

  assert.match(stylesSource, /\.tps-gcm-task-editor-properties\s*\{/u);
  assert.match(stylesSource, /\.tps-gcm-task-editor-property-control/u);
  assert.match(
    stylesSource,
    /@media \(max-width: 600px\)[\s\S]*?\.tps-gcm-task-editor-property-(?:input|button)[\s\S]*?font-size:\s*(?:max\([^;]*16px[^;]*\)|16px)/u,
    'mobile property inputs must use at least 16px text to avoid keyboard zoom and remain usable above the keyboard',
  );
});
