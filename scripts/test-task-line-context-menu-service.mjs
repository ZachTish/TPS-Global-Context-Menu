import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const serviceSource = readFileSync(new URL('../src/services/task-line-context-menu-service.ts', import.meta.url), 'utf8');
const pluginStylesSource = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');
const dragServiceSource = readFileSync(new URL('../src/services/task-line-drag-service.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const timeTrackingSource = readFileSync(new URL('../src/services/time-tracking-service.ts', import.meta.url), 'utf8');
const persistentMenuSource = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');
const createTaskServiceSource = readFileSync(new URL('../src/services/create-task-service.ts', import.meta.url), 'utf8');
const aiAssistedTaskServiceSource = readFileSync(new URL('../src/services/ai-assisted-task-service.ts', import.meta.url), 'utf8');
const createTaskModalSource = readFileSync(new URL('../src/modals/create-task-modal.ts', import.meta.url), 'utf8');
const aiAssistedTaskModalSource = readFileSync(new URL('../src/modals/ai-assisted-task-modal.ts', import.meta.url), 'utf8');
const commandsSource = readFileSync(new URL('../src/commands/register-commands.ts', import.meta.url), 'utf8');
const taskRecurrenceServiceSource = readFileSync(new URL('../src/services/task-recurrence-service.ts', import.meta.url), 'utf8');
const recurrenceModalSource = readFileSync(new URL('../src/modals/recurrence-modal.ts', import.meta.url), 'utf8');
const inlinePropertySuggestSource = readFileSync(new URL('../src/services/inline-property-suggest.ts', import.meta.url), 'utf8');
const inlinePropertyDecorationSource = readFileSync(new URL('../src/services/inline-property-decoration-service.ts', import.meta.url), 'utf8');
const ruleEngineSource = readFileSync(new URL('../src/services/notebook-navigator-rule-engine.ts', import.meta.url), 'utf8');
const noteOperationSource = readFileSync(new URL('../src/services/note-operation-service.ts', import.meta.url), 'utf8');
const fileNamingSource = readFileSync(new URL('../src/services/file-naming-service.ts', import.meta.url), 'utf8');
const dailyNavSource = readFileSync(new URL('../src/handlers/daily-note-nav-manager.ts', import.meta.url), 'utf8');
const bulkEditSource = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');
const dailyNoteScheduleSource = readFileSync(new URL('../src/utils/daily-note-task-schedule.ts', import.meta.url), 'utf8');
const dateSuffixSource = readFileSync(new URL('../src/utils/date-suffix-utils.ts', import.meta.url), 'utf8');
const settingsTabSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const constantsSource = readFileSync(new URL('../src/constants.ts', import.meta.url), 'utf8');
const taskCheckboxHandlerSource = readFileSync(new URL('../src/handlers/task-checkbox-handler.ts', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const subitemCreationSource = readFileSync(new URL('../src/services/subitem-creation-service.ts', import.meta.url), 'utf8');
const dailyInboxLineSource = readFileSync(new URL('../src/services/daily-inbox-line-service.ts', import.meta.url), 'utf8');
const notebookRuleSettingsSource = readFileSync(new URL('../src/services/notebook-navigator-rule-settings.ts', import.meta.url), 'utf8');
const taskLineResolutionSource = readFileSync(new URL('../src/utils/task-line-resolution.ts', import.meta.url), 'utf8');

test('task checkbox UI mutations share ownership cleanup and atomic mapping guards', () => {
  assert.doesNotMatch(serviceSource, /setTaskCheckboxToken\(/u);
  assert.ok(
    (serviceSource.match(/this\.updateTaskStatus\(/gu) || []).length >= 5,
    'quick toggle, Base picker, quick status, context menu, and custom marker must share the guarded status writer',
  );
  assert.ok(
    (serviceSource.match(/this\.setTaskStatusCheckboxState\(/gu) || []).length >= 3,
    'the guarded status writer, multi-select, and timer duplication must share checkbox-owned field cleanup',
  );
  assert.match(serviceSource, /getTaskCheckboxWorkflowMutationSignature\(/u);
  assert.match(serviceSource, /expectedMappingSignature/u);
  assert.match(serviceSource, /getLinkedSubitemMappingForState\(liveMappings, currentParsed\.token/u);
  assert.match(serviceSource, /getLinkedSubitemMappingForState\(liveMappings \|\| \[\], nextParsed\.token/u);
  assert.match(taskCheckboxHandlerSource, /setTaskCheckboxWorkflowState\(line, token/u);
  assert.match(taskCheckboxHandlerSource, /getCheckboxMutationSignature\(liveMappings\) !== expectedMappingSignature/u);
  assert.match(taskCheckboxHandlerSource, /getLinkedSubitemMappingForState\(liveMappings, token/u);
});

test('direct task UI writes journal only confirmed user mutations with atomic identity injection', () => {
  const updateStart = serviceSource.indexOf('private async updateTaskLine(');
  const updateEnd = serviceSource.indexOf('private async updateTaskLines(', updateStart);
  const updateSource = serviceSource.slice(updateStart, updateEnd);
  assert.ok(updateStart >= 0 && updateEnd > updateStart);
  assert.match(updateSource, /await beginDirectTaskHistory\(this\.plugin\.itemHistoryService/u);
  assert.ok(
    updateSource.indexOf('beginDirectTaskHistory') < updateSource.indexOf('this.plugin.app.vault.process'),
    'the pending history intent must be written before the task mutation starts',
  );
  assert.match(updateSource, /ensureDirectTaskHistoryIdentity\([\s\S]{0,420}lines\[lineIndex\] = nextLine/u);
  assert.match(updateSource, /if \(!changed\) \{[\s\S]{0,220}abortDirectTaskHistory/u);
  assert.match(updateSource, /confirmedHistoryBefore = \{[\s\S]{0,160}rawLine: currentLine/u);
  assert.match(updateSource, /commitDirectTaskHistory\([\s\S]{0,180}confirmedBefore: confirmedHistoryBefore/u);
  assert.match(updateSource, /sourceDisposition: 'retained'/u);
  assert.match(updateSource, /sourceDisposition: 'removed'/u);
  assert.match(updateSource, /surface: context\.isCalendarTask \? 'calendar-task-context-menu' : 'task-line-context-menu'/u);
  assert.match(taskCheckboxHandlerSource, /action: 'task\.checkbox'/u);
  assert.match(taskCheckboxHandlerSource, /surface: 'checkbox-context-menu'/u);
  assert.match(taskCheckboxHandlerSource, /ensureDirectTaskHistoryIdentity\([\s\S]{0,420}lines\[lineIndex\] = updatedLine/u);
  assert.match(taskCheckboxHandlerSource, /confirmedHistoryBefore = \{[\s\S]{0,160}rawLine: currentLine/u);
  const deleteTargetStart = serviceSource.indexOf('private createTaskDeleteTarget(');
  const deleteTargetEnd = serviceSource.indexOf('private async moveTaskToFile(', deleteTargetStart);
  const deleteTargetSource = serviceSource.slice(deleteTargetStart, deleteTargetEnd);
  assert.ok(deleteTargetStart >= 0 && deleteTargetEnd > deleteTargetStart);
  assert.match(deleteTargetSource, /taskHistory: \{[\s\S]{0,180}service: this\.plugin\.itemHistoryService/u);
  assert.match(deleteTargetSource, /kind: 'user'/u);
  assert.match(deleteTargetSource, /sourcePluginId: 'tps-global-context-menu'/u);
  assert.match(deleteTargetSource, /surface: context\.isCalendarTask \? 'calendar-task-context-menu' : 'task-line-context-menu'/u);
});

test('task resolution inherits exact source metadata from rendered surface hosts', () => {
  assert.match(serviceSource, /closest<HTMLElement>\('\[data-task-path\], \[data-tps-kanban-path\], \[data-source-path\], \[data-file-path\], \[data-path\]'\)/);
  assert.match(serviceSource, /metadataHost\?\.dataset\.sourcePath/);
  assert.match(serviceSource, /closest<HTMLElement>\('\[data-task-line\], \[data-tps-kanban-line\]'\)/);
  assert.match(serviceSource, /TaskLineResolve', 'line:unresolved'/);
});

test('TPS Table task ranges synchronize into the canonical batch task menu before opening', () => {
  assert.match(serviceSource, /surface === 'tps-table'[\s\S]{0,120}this\.routeTpsTableSelection\(evt, taskEl, true\)/);
  assert.match(serviceSource, /void \(baseSelection \?\? Promise\.resolve\(\)\)\.then\(\(\) => this\.resolveContext/);
  assert.match(serviceSource, /private routeTpsTableSelection\(/);
  assert.match(serviceSource, /applyTpsTableRowSelection\?:/);
  assert.match(serviceSource, /async syncTpsTableSelectionRows\(/);
  assert.match(serviceSource, /mode: 'tps-table-sync'/);
  assert.match(serviceSource, /releaseTpsTableSelection\(owner: HTMLElement\)/);
  assert.doesNotMatch(mainSource, /tableView\?\.applyEntryContextSelection\?\.\(evt, row\)/);
});

test('Home Daily Note tasks use standard task interactions while the capture editor stays isolated', () => {
  assert.doesNotMatch(serviceSource, /'\.tps-home-capture-preview-body'/);
  assert.match(serviceSource, /isTaskInteractionBoundary[\s\S]*\.tps-home-native-capture-editor/);
  assert.match(serviceSource, /closest\('\.markdown-reading-view, \.markdown-preview-view, \.markdown-rendered'\)/);
  assert.match(serviceSource, /querySelectorAll<HTMLElement>\('\[data-task-path\]\[data-task-line\]'\)/);
});

test('GCM task and bullet line flows can create a linked child note without dropping line metadata', () => {
  assert.match(serviceSource, /setTitle\(hasAssociatedNote \? 'Open linked note' : 'Create note for task'\)/);
  assert.match(serviceSource, /dailyInboxLineService\.createNoteForLine\(context\)/);
  assert.match(dailyInboxLineSource, /async createNoteForLine\(context: LineContext\)/);
  assert.match(dailyInboxLineSource, /await this\.refreshLineContext\(context\)/);
  assert.match(dailyInboxLineSource, /readTaskAssociatedNotePath\(context\.rawLine\)/);
  assert.match(dailyInboxLineSource, /createSubitemForParentWithTitle/);
  assert.match(dailyInboxLineSource, /insertParentBodyLink: false/);
  assert.match(dailyInboxLineSource, /inheritParentTemporalMetadata: false/);
  assert.match(dailyInboxLineSource, /\(currentLine\) => this\.associateLineWithNote\(currentLine, noteFile\.path, title\)/);
  assert.match(dailyInboxLineSource, /private associateLineWithNote\(line: string, notePath: string, fallbackTitle: string\)/);
  const dailyInboxUpdateStart = dailyInboxLineSource.indexOf('private async updateLineInFile(');
  const dailyInboxUpdateEnd = dailyInboxLineSource.indexOf('private resolveLineIndex(', dailyInboxUpdateStart);
  const dailyInboxUpdateSource = dailyInboxLineSource.slice(dailyInboxUpdateStart, dailyInboxUpdateEnd);
  assert.match(dailyInboxUpdateSource, /await beginDirectTaskHistory\(this\.plugin\.itemHistoryService/u);
  assert.match(dailyInboxUpdateSource, /confirmedHistoryBefore = \{[\s\S]{0,160}rawLine: currentLine/u);
  assert.match(dailyInboxUpdateSource, /ensureDirectTaskHistoryIdentity\(/u);
  assert.match(dailyInboxUpdateSource, /commitDirectTaskHistory\([\s\S]{0,220}confirmedBefore: confirmedHistoryBefore/u);
  assert.doesNotMatch(dailyInboxLineSource, /setTaskAssociatedNotePath\(context\.rawLine, noteFile\.path\)/);
  assert.match(dailyInboxLineSource, /if \(!sourceUpdated\) \{[\s\S]{0,420}stage: 'write-source-association'[\s\S]{0,180}return null;/);
  assert.ok(
    dailyInboxLineSource.indexOf("stage: 'write-source-association'") <
      dailyInboxLineSource.indexOf('const opened = await this.openAssociatedNote(noteFile)'),
    'a failed association write must return before opening the note',
  );
  assert.match(dailyInboxLineSource, /catch \(error\) \{[\s\S]{0,160}line-update:failed/);
  assert.match(dailyInboxLineSource, /resolveUniqueMatchingChildNote\(title, context\.file\)/);
  assert.match(dailyInboxLineSource, /parentLinkResolutionService\.hasParent\(candidate, sourceFile\)/);
  assert.match(subitemCreationSource, /const racedTarget = plugin\.app\.vault\.getAbstractFileByPath\(targetPath\)/);
  assert.match(subitemCreationSource, /create:race-recovered/);
  assert.match(dailyInboxLineSource, /parts\.suffix/);
});
const notebookRuleServiceSource = readFileSync(new URL('../src/services/notebook-navigator-rule-service.ts', import.meta.url), 'utf8');
const taskApiSource = readFileSync(new URL('../src/services/task-api-service.ts', import.meta.url), 'utf8');
const linkedSubitemCheckboxSource = readFileSync(new URL('../src/services/linked-subitem-checkbox-service.ts', import.meta.url), 'utf8');
const logBaseViewSource = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
const mobileOverlaySource = readFileSync(new URL('../src/utils/mobile-overlay.ts', import.meta.url), 'utf8');

async function importUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/task-line-metadata.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

async function importMobileOverlayUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/mobile-overlay.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

async function importTaskHighlightMetadataUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/task-highlight-metadata.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

async function importTaskLineResolutionUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/task-line-resolution.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

async function importTaskCheckboxWorkflowUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/task-checkbox-workflow-mutation.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

async function importCreateTaskUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/create-task-parser.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

async function importTaskBlockMoveUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/task-block-move.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

async function importTaskRecurrenceUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/task-recurrence.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

async function importDateSuffixUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/date-suffix-utils.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

test('task line metadata helpers edit task text without destroying inline task properties', async () => {
  const {
    getTaskDisplayTitle,
    convertTaskLineToBullet,
    setTaskEditableBody,
    setTaskCheckboxToken,
    setTaskTitle,
    updateTaskCompletedDateForCheckboxState,
    updateTaskLineTimestamps,
    setInlineFieldValueOnTaskLine,
    setInlineFieldValueOnLine,
    addInlineTagToTaskLine,
    removeInlineTagFromTaskLine,
    readInlineFieldValue,
    readTaskInlineFieldRecord,
    readInlineTags,
    readTaskLineTags,
    parseTaskTagValues,
    insertLineAfterFrontmatter,
  } = await importUtility();

  const line = '- [ ] bathroom window [priority:: high] [scheduled:: 2026-05-31 09:00:00] #topic/home';
  assert.equal(getTaskDisplayTitle(line), 'bathroom window');
  assert.equal(
    getTaskDisplayTitle('- [ ] MDM SMART Item Multi-Team Touchpoint [scheduled:: 2026-07-02 08:30:00] #hca %% tps-inline-props:{"externalEventId":"abc"} %%'),
    'MDM SMART Item Multi-Team Touchpoint',
  );
  assert.equal(
    setTaskTitle(line, 'main bathroom window'),
    '- [ ] main bathroom window [priority:: high] [scheduled:: 2026-05-31 09:00:00] #topic/home',
  );
  const reminderMetadata = '%% tps-inline-props:{"externalId":"reminders:x-apple-reminder://ABC","remindersSyncedTitle":"old title"} %%';
  const reminderLine = `- [ ] old title [tpsId:: item_abc] [scheduled:: 2026-07-11 09:00:00] #inbox ${reminderMetadata}`;
  assert.equal(
    setTaskTitle(reminderLine, 'new title'),
    `- [ ] new title [tpsId:: item_abc] [scheduled:: 2026-07-11 09:00:00] #inbox ${reminderMetadata}`,
  );
  assert.equal(
    setTaskEditableBody(reminderLine, 'new body #inbox'),
    `- [ ] new body #inbox [tpsId:: item_abc] [scheduled:: 2026-07-11 09:00:00] ${reminderMetadata}`,
  );
  assert.equal(setTaskCheckboxToken(line, '[\\]'), '- [\\] bathroom window [priority:: high] [scheduled:: 2026-05-31 09:00:00] #topic/home');
  assert.equal(
    convertTaskLineToBullet('  - [x] finished task #work [completedDate:: 2026-07-10 12:00:00]'),
    '  - finished task #work',
  );
  assert.equal(readInlineFieldValue(line, 'priority'), 'high');
  const inlineFieldRecord = readTaskInlineFieldRecord(
    '- [ ] scoped task [Projects:: ] [priority:: high] [projects:: [[Ignored duplicate]]]',
  );
  assert.deepEqual(inlineFieldRecord, {
    Projects: '',
    priority: 'high',
  });
  assert.equal(Object.prototype.hasOwnProperty.call(inlineFieldRecord, 'Projects'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(inlineFieldRecord, 'contexts'), false);
  assert.equal(setInlineFieldValueOnTaskLine(line, 'priority', 'normal'), '- [ ] bathroom window [scheduled:: 2026-05-31 09:00:00] #topic/home [priority:: normal]');
  assert.equal(
    setInlineFieldValueOnLine('  - Nested reminder [scheduled:: 2026-05-31 09:00:00] [status:: active]', 'scheduled', '2026-06-01 10:30:00'),
    '  - Nested reminder [status:: active] [scheduled:: 2026-06-01 10:30:00]',
  );
  assert.equal(
    setInlineFieldValueOnLine('  - Nested reminder [scheduled:: 2026-05-31 09:00:00] [status:: active]', 'scheduled', null),
    '  - Nested reminder [status:: active]',
  );
  assert.deepEqual(readInlineTags(line), ['topic/home']);
  assert.deepEqual(
    readTaskLineTags('- [ ] Tagged #a #ab #abc #abcd [tags:: #café, #仕事]'),
    ['a', 'ab', 'abc', 'abcd', 'café', '仕事'],
  );
  assert.deepEqual(
    parseTaskTagValues(['#a #ab', '#abc, #abcd', '#café', '#仕事']),
    ['a', 'ab', 'abc', 'abcd', 'café', '仕事'],
  );
  assert.equal(addInlineTagToTaskLine(line, '#topic/home'), line);
  assert.equal(addInlineTagToTaskLine(line, 'errand'), `${line} #errand`);
  assert.equal(removeInlineTagFromTaskLine(`${line} #errand`, 'topic/home'), '- [ ] bathroom window [priority:: high] [scheduled:: 2026-05-31 09:00:00] #errand');
  const bulletLine = '- Alpha release [status:: active] #existing';
  assert.deepEqual(readInlineTags(bulletLine), ['existing']);
  assert.equal(addInlineTagToTaskLine(bulletLine, '#qa/base'), `${bulletLine} #qa/base`);
  assert.equal(removeInlineTagFromTaskLine(bulletLine, 'existing'), '- Alpha release [status:: active]');
  assert.equal(
    insertLineAfterFrontmatter('---\ntitle: Target\n---\n\nExisting body\n', '- [ ] moved task'),
    '---\ntitle: Target\n---\n\nExisting body\n- [ ] moved task\n',
  );
  assert.equal(
    insertLineAfterFrontmatter('Existing body\n', '- [ ] moved task'),
    'Existing body\n- [ ] moved task\n',
  );
  assert.equal(
    updateTaskCompletedDateForCheckboxState('- [x] completed task', '[x]', {
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }),
    '- [x] completed task [completedDate:: 2026-06-03 14:05:06]',
  );
  assert.equal(
    updateTaskCompletedDateForCheckboxState('- [X] uppercase completed task', '[X]', {
      completeMarkers: ['x'],
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }),
    '- [X] uppercase completed task [completedDate:: 2026-06-03 14:05:06]',
  );
  assert.equal(
    updateTaskCompletedDateForCheckboxState('- [x] completed task [completedDate:: 2026-06-01 09:00:00]', '[x]', {
      completedAt: new Date(2026, 5, 3, 14, 5, 6),
    }),
    '- [x] completed task [completedDate:: 2026-06-01 09:00:00]',
  );
  assert.equal(
    updateTaskCompletedDateForCheckboxState('- [ ] reopened task [completedDate:: 2026-06-01 09:00:00]', '[ ]'),
    '- [ ] reopened task',
  );
  assert.equal(
    updateTaskLineTimestamps('- [ ] new task', {
      createdKey: 'createdAt',
      modifiedKey: 'updatedAt',
      now: new Date(2026, 5, 3, 14, 5, 6),
      markCreated: true,
      markModified: true,
    }),
    '- [ ] new task [createdAt:: 2026-06-03 14:05:06] [updatedAt:: 2026-06-03 14:05:06]',
  );
  assert.equal(
    updateTaskLineTimestamps('- [ ] old task [createdAt:: 2026-06-01 09:00:00]', {
      createdKey: 'createdAt',
      modifiedKey: 'updatedAt',
      now: new Date(2026, 5, 3, 14, 5, 6),
      markCreated: true,
      markModified: true,
    }),
    '- [ ] old task [createdAt:: 2026-06-01 09:00:00] [updatedAt:: 2026-06-03 14:05:06]',
  );
  assert.equal(
    updateTaskLineTimestamps('- [ ] quiet task', {
      enabled: false,
      createdKey: 'createdAt',
      modifiedKey: 'updatedAt',
      now: new Date(2026, 5, 3, 14, 5, 6),
      markCreated: true,
      markModified: true,
    }),
    '- [ ] quiet task',
  );
});

test('task note associations use a hidden direct path while keeping the visible task title plain', async () => {
  const {
    getPlainTaskTitle,
    getTaskDisplayTitle,
    normalizeTaskAssociatedNotePath,
    parseTaskTitleLink,
    readTaskAssociatedNotePath,
    setTaskAssociatedNotePath,
    setTaskTitle,
  } = await importUtility();

  assert.deepEqual(parseTaskTitleLink('[[Birthday Dinner#2026-07-13|Birthday Dinner]]'), {
    targetPath: 'Birthday Dinner',
    displayTitle: 'Birthday Dinner',
  });
  assert.deepEqual(parseTaskTitleLink('[Project brief](Projects/Project%20Brief.md#Next)'), {
    targetPath: 'Projects/Project Brief.md',
    displayTitle: 'Project brief',
  });
  assert.equal(parseTaskTitleLink('[Event](https://calendar.example.test/events/123)'), null);
  assert.equal(getPlainTaskTitle('[Event](https://calendar.example.test/events/123)'), 'Event');
  assert.deepEqual(parseTaskTitleLink('[[Notes/Project#Next|Project]] follow up with Pat'), {
    targetPath: 'Notes/Project',
    displayTitle: 'Project follow up with Pat',
  });
  assert.deepEqual(parseTaskTitleLink('[Project](Notes/Project%20Brief.md#Next) follow up'), {
    targetPath: 'Notes/Project Brief.md',
    displayTitle: 'Project follow up',
  });
  assert.equal(parseTaskTitleLink('[Website](https://example.test/event) follow up'), null);
  assert.equal(getPlainTaskTitle('[Website](https://example.test/event) follow up'), 'Website follow up');
  assert.equal(parseTaskTitleLink('Review [[Reference]] later'), null);
  assert.equal(normalizeTaskAssociatedNotePath('https://example.test/note'), '');
  assert.equal(normalizeTaskAssociatedNotePath('//example.test/note'), '');
  assert.equal(normalizeTaskAssociatedNotePath('%68%74%74%70%73%3A%2F%2Fexample.test%2Fnote'), '');

  const reminderMetadata = '%% tps-inline-props:{"externalId":"reminders:x-apple-reminder://ABC","remindersSyncedTitle":"Birthday Dinner"} %%';
  const legacyLine = `- [ ] [[Birthday Dinner#2026-07-13|Birthday Dinner]] [scheduled:: 2026-07-13 18:00:00] [tpsId:: item_abc] #family ${reminderMetadata}`;
  const associated = setTaskAssociatedNotePath(legacyLine, 'Notes/Birthday Dinner.md');
  assert.equal(readTaskAssociatedNotePath(associated), 'Notes/Birthday Dinner.md');
  assert.match(associated, /"externalId":"reminders:x-apple-reminder:\/\/ABC"/);
  assert.match(associated, /"remindersSyncedTitle":"Birthday Dinner"/);
  assert.match(associated, /"associatedNotePath":"Notes\/Birthday Dinner\.md"/);

  const plainLine = setTaskTitle(associated, getPlainTaskTitle(getTaskDisplayTitle(legacyLine)));
  assert.equal(
    plainLine,
    '- [ ] Birthday Dinner [scheduled:: 2026-07-13 18:00:00] [tpsId:: item_abc] #family %% tps-inline-props:{"externalId":"reminders:x-apple-reminder://ABC","remindersSyncedTitle":"Birthday Dinner","associatedNotePath":"Notes/Birthday Dinner.md"} %%',
  );
  assert.equal(setTaskAssociatedNotePath(plainLine, 'Notes/Birthday Dinner.md'), plainLine);

  const encoded = encodeURIComponent(JSON.stringify({
    externalId: 'calendar:event-(123)',
    ASSOCIATEDNOTEPATH: 'Notes/Old%20Task.md',
    concurrentFlag: true,
  }));
  const encodedLine = `- [ ] Encoded task [tpsInlineProps:: ${encoded}]`;
  assert.equal(readTaskAssociatedNotePath(encodedLine), 'Notes/Old Task.md');
  const encodedUpdated = setTaskAssociatedNotePath(encodedLine, 'Notes/Moved Task.md');
  const encodedUpdatedPayload = encodedUpdated.match(/\[tpsInlineProps:: ([^\]]+)]/)?.[1];
  assert.ok(encodedUpdatedPayload);
  assert.deepEqual(JSON.parse(decodeURIComponent(encodedUpdatedPayload)), {
    externalId: 'calendar:event-(123)',
    concurrentFlag: true,
    ASSOCIATEDNOTEPATH: 'Notes/Moved Task.md',
  });
  assert.doesNotMatch(encodedUpdated, /%%\s*tps-inline-props:/);
  const encodedRenamed = setTaskTitle(encodedUpdated, 'Encoded task renamed');
  assert.equal(readTaskAssociatedNotePath(encodedRenamed), 'Notes/Moved Task.md');
  assert.match(encodedRenamed, /calendar%3Aevent-\(123\)/);

  const rawCommentLine = '- Raw comment %% TPS-INLINE-PROPS : {"ExternalId":"event-raw","AssociatedNotePath":"Notes/Raw.md"} %%';
  assert.equal(readTaskAssociatedNotePath(rawCommentLine), 'Notes/Raw.md');
  const rawCommentUpdated = setTaskAssociatedNotePath(rawCommentLine, 'Notes/Raw Moved.md');
  assert.match(rawCommentUpdated, /"ExternalId":"event-raw"/);
  assert.match(rawCommentUpdated, /"AssociatedNotePath":"Notes\/Raw Moved\.md"/);

  const htmlCommentLine = '- [ ] HTML comment <!-- TPS-INLINE-PROPS: {"ExternalId":"event-456","associatednotepath":"Notes/HTML.md"} -->';
  assert.equal(readTaskAssociatedNotePath(htmlCommentLine), 'Notes/HTML.md');
  assert.match(setTaskAssociatedNotePath(htmlCommentLine, 'Notes/HTML Moved.md'), /"associatednotepath":"Notes\/HTML Moved\.md"/);

  const spanPayload = encodeURIComponent(JSON.stringify({ externalId: 'event-789', AssociatedNotePath: 'Notes/Span.md' }));
  const spanLine = `- [ ] Span task <span data-tps-inline-props="${spanPayload}"></span>`;
  assert.equal(readTaskAssociatedNotePath(spanLine), 'Notes/Span.md');
  const spanUpdated = setTaskAssociatedNotePath(spanLine, 'Notes/Span Moved.md');
  const spanUpdatedPayload = spanUpdated.match(/data-tps-inline-props="([^"]+)"/)?.[1];
  assert.ok(spanUpdatedPayload);
  assert.deepEqual(JSON.parse(decodeURIComponent(spanUpdatedPayload)), {
    externalId: 'event-789',
    AssociatedNotePath: 'Notes/Span Moved.md',
  });

  const entitySpanLine = '- Entity span <span data-tps-inline-props="{&quot;externalId&quot;:&quot;event-entity&quot;,&quot;associatednotepath&quot;:&quot;Notes/Entity.md&quot;}"></span>';
  assert.equal(readTaskAssociatedNotePath(entitySpanLine), 'Notes/Entity.md');
  const entitySpanUpdated = setTaskAssociatedNotePath(entitySpanLine, 'Notes/Entity Moved.md');
  assert.match(entitySpanUpdated, /&quot;externalId&quot;:&quot;event-entity&quot;/);
  assert.match(entitySpanUpdated, /&quot;associatednotepath&quot;:&quot;Notes\/Entity Moved\.md&quot;/);

  const unsafeHiddenLine = '- [ ] Unsafe %% tps-inline-props:{"externalId":"safe","associatedNotePath":"//example.test/note"} %%';
  assert.equal(readTaskAssociatedNotePath(unsafeHiddenLine), '');
  assert.equal(setTaskAssociatedNotePath(unsafeHiddenLine, 'https://example.test/note'), unsafeHiddenLine);
});

test('task quick editor can replace the editable body without changing task structure', async () => {
  const { getTaskEditableBody, setTaskEditableBody } = await importUtility();
  const line = '  - [/] Draft *proposal* #work [priority:: high]';
  assert.equal(getTaskEditableBody(line), 'Draft *proposal* #work');
  assert.equal(
    setTaskEditableBody(line, 'Review **proposal** #work'),
    '  - [/] Review **proposal** #work [priority:: high]',
  );
  assert.equal(setTaskEditableBody(line, getTaskEditableBody(line)), line, 'a no-op save must preserve exact field positions');
  assert.equal(
    setTaskEditableBody('- [ ] Legacy task [subitemId:: legacy_123]', 'Renamed legacy task'),
    '- [ ] Renamed legacy task [subitemId:: legacy_123]',
  );
  const hiddenPayload = '%% tps-inline-props:{"externalId":"sync-current","remindersNotes":""} %%';
  const protectedLine = `- [ ] Visible #work [priority:: high] [tpsId:: tps_123] [subitemId:: sub_456] ${hiddenPayload}`;
  assert.equal(getTaskEditableBody(protectedLine), 'Visible #work');
  const carrierPayload = JSON.stringify({ externalId: 'carrier-current', remindersNotes: '' });
  const carrierLines = [
    `- [ ] Visible #work [priority:: high] [tpsInlineProps:: ${encodeURIComponent(carrierPayload)}]`,
    `- [ ] Visible #work [priority:: high] <!-- tps-inline-props:${carrierPayload} -->`,
    `- [ ] Visible #work [priority:: high] <span data-tps-inline-props="${encodeURIComponent(carrierPayload)}"></span>`,
  ];
  for (const carrierLine of carrierLines) {
    assert.equal(getTaskEditableBody(carrierLine), 'Visible #work');
    assert.equal(setTaskEditableBody(carrierLine, 'Updated #work'), carrierLine.replace('Visible #work', 'Updated #work'));
  }
  assert.equal(
    setTaskEditableBody(protectedLine, 'Updated #work'),
    `- [ ] Updated #work [priority:: high] [tpsId:: tps_123] [subitemId:: sub_456] ${hiddenPayload}`,
  );
  assert.equal(
    setTaskEditableBody(protectedLine, 'Updated %% tps-inline-props:{"externalId":"pasted"} %%'),
    `- [ ] Updated [priority:: high] [tpsId:: tps_123] [subitemId:: sub_456] ${hiddenPayload}`,
    'pasted hidden metadata must not replace the current source-line identity payload',
  );
  const staleOpeningPayload = '%% tps-inline-props:{"externalId":"sync-opening"} %%';
  const openingLine = `- [ ] Original [tpsId:: tps_123] ${staleOpeningPayload}`;
  const currentPayload = '%% tps-inline-props:{"externalId":"sync-current","remindersPriority":2} %%';
  const currentLine = `- [ ] Original [tpsId:: tps_123] ${currentPayload}`;
  const editedFromOpeningBody = getTaskEditableBody(openingLine).replace('Original', 'Edited');
  const concurrentResult = setTaskEditableBody(currentLine, editedFromOpeningBody);
  assert.match(concurrentResult, /"externalId":"sync-current"/);
  assert.match(concurrentResult, /"remindersPriority":2/);
  assert.doesNotMatch(concurrentResult, /sync-opening/);
  const overlappingMetadata = '- [ ] Visible [notes:: see [priority:: high]] [priority:: high] [priority:: high]';
  assert.equal(
    setTaskEditableBody(overlappingMetadata, 'Updated'),
    '- [ ] Updated [notes:: see [priority:: high]] [priority:: high] [priority:: high]',
    'edited saves must preserve duplicate and substring-overlapping inline fields in source order',
  );
  assert.equal(setTaskEditableBody(line, '   '), line);
});

test('normal task clicks open the exact-line quick editor across task surfaces', () => {
  assert.match(serviceSource, /data-tps-gcm-context="table-task"/);
  assert.match(serviceSource, /private showTaskEditor\(context: TaskLineContext, anchorEl: HTMLElement\)/);
  assert.match(serviceSource, /async openQuickEditorForElement\(taskEl: HTMLElement, sourceEl: HTMLElement \| null = taskEl\)/);
  assert.match(serviceSource, /getTaskEditableBody\(context\.rawLine\)/);
  assert.match(serviceSource, /setTaskEditableBody\(line, nextBody\)/);
  assert.match(serviceSource, /existing properties\. Hidden TPS metadata stays attached/);
  assert.match(serviceSource, /if \(!bodyChanged && propertyChanges\.length === 0\)/);
  assert.match(serviceSource, /this\.updateTaskLine\(context/);
  assert.match(serviceSource, /TaskQuickEditor', 'open'/);
  assert.match(serviceSource, /TaskQuickEditor', 'save'/);
  assert.match(serviceSource, /tps-gcm-task-editor-checkbox/);
  assert.match(serviceSource, /cls: 'task-list-item-checkbox tps-gcm-task-editor-checkbox'/);
  assert.match(serviceSource, /type: 'checkbox'/);
  assert.match(serviceSource, /button\.indeterminate = marker !== ' ' && !complete/);
  assert.match(serviceSource, /handleContextMenu\(evt: MouseEvent\): boolean \{\s*const target[^\n]+\n\s*if \(this\.isTaskInteractionBoundary\(target\) \|\| this\.isTaskPropertyTarget\(target\)\) return false;/);
  assert.match(serviceSource, /private isTaskInteractionBoundary\(target: HTMLElement \| null\): boolean/);
  assert.match(serviceSource, /'\.modal'/);
  assert.match(serviceSource, /'\.menu'/);
  assert.match(serviceSource, /private isTaskEditorActivationTarget\(target: HTMLElement \| null, taskEl: HTMLElement\): boolean/);
  assert.match(serviceSource, /\.tps-list-native-title-button, \.tps-list-native-title/);
  assert.match(serviceSource, /\.tps-log-base-cell\[data-key="title"\]/);
  assert.doesNotMatch(serviceSource, /resolveTaskElementAtPoint|resolveTaskElementByPointBounds|elementsFromPoint/);
  assert.match(serviceSource, /private showTaskEditorStatusMenu\(/);
  assert.match(serviceSource, /window\.setTimeout\(\(\) => \{[\s\S]*?\}, 500\)/);
  assert.match(serviceSource, /Bullet — No status/);
  assert.match(serviceSource, /convertTaskLineToBullet/);
  assert.match(serviceSource, /nextMarker = nextParsed\?\.marker \?\? null/);
  assert.match(serviceSource, /event\.key === 'Enter' && \(event\.metaKey \|\| event\.ctrlKey\)/);
  assert.match(pluginStylesSource, /\.tps-gcm-task-editor-card\s*\{/);
  assert.match(pluginStylesSource, /\.tps-gcm-task-editor-row\s*\{/);
  assert.match(pluginStylesSource, /\.tps-gcm-task-editor-checkbox\s*\{/);
  assert.match(pluginStylesSource, /\.tps-gcm-task-editor-input\s*\{/);
  assert.match(mainSource, /this\.taskLineContextMenuService\?\.dispose\(\)/);
});

test('TPS List task titles defer to unified row selection while TPS Table modifiers defer to table rows', () => {
  assert.match(serviceSource, /private taskSelectionAnchor: TaskLineContext \| null = null/);
  assert.match(serviceSource, /private tpsListSelectionSyncGeneration = 0/);
  assert.match(serviceSource, /private tpsListSelectionOwner: HTMLElement \| null = null/);
  assert.match(serviceSource, /const surface = taskElSurface\(taskEl\)/);
  assert.match(serviceSource, /if \(surface === 'tps-table' && \(evt\.shiftKey \|\| evt\.metaKey \|\| evt\.ctrlKey\)\) return false/);
  assert.match(serviceSource, /const listSelection = surface === 'tps-list' \? this\.routeTpsListSelection\(evt, taskEl\) : null/);
  assert.match(serviceSource, /if \(listSelection && \(evt\.shiftKey \|\| evt\.metaKey \|\| evt\.ctrlKey\)\)/);
  assert.match(serviceSource, /private routeTpsListSelection\(/);
  assert.match(serviceSource, /applyTpsListRowSelection\?: \(/);
  assert.match(serviceSource, /async syncTpsListSelectionRows\([\s\S]{0,180}owner: HTMLElement/);
  assert.match(serviceSource, /taskRows = rows\.filter\(\(row\) => row\.matches\(/);
  assert.match(serviceSource, /Promise\.all\(taskRows\.map\(\(row\) => this\.resolveContext\(row, row\)\)\)/);
  assert.match(serviceSource, /generation !== this\.tpsListSelectionSyncGeneration/);
  assert.match(serviceSource, /this\.tpsListSelectionOwner = owner/);
  assert.match(serviceSource, /reconcileTpsListSelectionRows\(/);
  assert.match(serviceSource, /if \(this\.tpsListSelectionOwner !== owner\) return Promise\.resolve\(\)/);
  assert.match(serviceSource, /releaseTpsListSelection\(owner: HTMLElement\): void/);
  assert.match(serviceSource, /releaseTpsListSelection\(owner: HTMLElement\): void \{\s*if \(this\.tpsListSelectionOwner !== owner\) return;\s*this\.tpsListSelectionSyncGeneration \+= 1;/);
  assert.match(serviceSource, /if \(surface !== 'tps-list'\) \{\s*this\.tpsListSelectionSyncGeneration \+= 1;\s*this\.tpsListSelectionOwner = null;/);
  assert.match(serviceSource, /matchTaskHighlightMetadata\(\{/);
  assert.match(serviceSource, /if \(metadataMatch != null\) return metadataMatch/);
  assert.match(serviceSource, /candidate != null/);
  assert.match(serviceSource, /a\.file\.path\.localeCompare\(b\.file\.path\) \|\| a\.lineIndex - b\.lineIndex/);
  assert.match(serviceSource, /refreshSelectionHighlights\(\): void/);
  assert.match(pluginStylesSource, /\[data-tps-gcm-context="table-task"\]\.tps-gcm-task-line-selected/);
});

test('task highlight metadata keeps TPS task lines one-based and native lines zero-based', async () => {
  const { matchTaskHighlightMetadata } = await importTaskHighlightMetadataUtility();
  const context = { filePath: 'Inbox/A.md', lineNumber: 16, lineIndex: 15 };

  assert.equal(matchTaskHighlightMetadata({ taskPath: 'Inbox/A.md', taskLine: '16' }, context), true);
  assert.equal(matchTaskHighlightMetadata({ taskPath: 'Inbox/A.md', taskLine: '15' }, context), false);
  assert.equal(matchTaskHighlightMetadata({ tpsKanbanPath: 'Inbox/A.md', tpsKanbanLine: '16' }, context), true);
  assert.equal(matchTaskHighlightMetadata({ taskLine: '', tpsKanbanLine: '16' }, context), true);
  assert.equal(matchTaskHighlightMetadata({ taskPath: 'Inbox/A.md', dataLine: '15' }, context), true);
  assert.equal(matchTaskHighlightMetadata({ taskPath: 'Inbox/A.md', dataLine: '16' }, context), false);
  assert.equal(matchTaskHighlightMetadata({ taskPath: 'Inbox/B.md', taskLine: '16' }, context), false);
  assert.equal(matchTaskHighlightMetadata({ taskPath: 'Inbox/A.md', taskLine: 'not-a-line' }, context), false);
  assert.equal(matchTaskHighlightMetadata({}, { filePath: 'Inbox/A.md', lineNumber: 1, lineIndex: 0 }), null);
  assert.equal(matchTaskHighlightMetadata({ taskLine: '' }, { filePath: 'Inbox/A.md', lineNumber: 1, lineIndex: 0 }), null);
});

test('TPS Table property cells resolve through the row task identity and exact one-based source line', async () => {
  const { buildTaskLineCandidateIndexes, getTaskLineIdentity, resolveTaskLineIndex } = await importTaskLineResolutionUtility();
  const lines = [
    '# Tasks',
    '- [ ] Draft Base filter examples [area:: work] [priority:: medium]',
    '- [/] Fix GCM filter cache [area:: work] [priority:: high]',
    '- [-] Wait for mobile reproduction [area:: work] [priority:: high]',
  ];
  const exactCandidates = buildTaskLineCandidateIndexes({
    lineCount: lines.length,
    pluginLine: '3',
  });

  assert.deepEqual(exactCandidates, [2], 'plugin task lines are one-based');
  assert.equal(
    resolveTaskLineIndex({
      lines,
      candidateIndexes: exactCandidates,
      targetTexts: ['working'],
      exactTaskText: 'Fix GCM filter cache',
      exactLineIdentity: getTaskLineIdentity(lines[2]),
    }),
    2,
    'a clicked Status cell must not replace the row task identity',
  );
  assert.equal(
    resolveTaskLineIndex({
      lines,
      candidateIndexes: exactCandidates,
      targetTexts: ['Fix GCM filter cache'],
      exactTaskText: 'Fix GCM filter cache',
      exactLineIdentity: getTaskLineIdentity(lines[2]),
    }),
    2,
    'the Title cell keeps resolving the same exact source task',
  );

  const staleCandidates = buildTaskLineCandidateIndexes({
    lineCount: lines.length,
    pluginLine: '2',
  });
  assert.equal(
    resolveTaskLineIndex({
      lines,
      candidateIndexes: staleCandidates,
      targetTexts: ['high'],
      exactTaskText: 'Fix GCM filter cache',
      exactLineIdentity: getTaskLineIdentity(lines[2]),
    }),
    2,
    'a shifted source line relocates only by its unique canonical title',
  );

  const duplicateLines = [
    '- [ ] Different task',
    '- [/] Fix GCM filter cache [priority:: high]',
    '- [ ] Fix GCM filter cache [priority:: low]',
  ];
  assert.equal(
    resolveTaskLineIndex({
      lines: duplicateLines,
      candidateIndexes: [2],
      targetTexts: ['high'],
      exactTaskText: 'Fix GCM filter cache',
      exactLineIdentity: getTaskLineIdentity(duplicateLines[1]),
    }),
    1,
    'an exact source-line identity relocates past a stale same-title candidate',
  );
  assert.equal(
    resolveTaskLineIndex({
      lines: duplicateLines,
      candidateIndexes: [2],
      targetTexts: ['high'],
      exactTaskText: 'Fix GCM filter cache',
    }),
    -1,
    'a stale row without an exact source-line identity fails closed on duplicate titles',
  );
  assert.equal(
    resolveTaskLineIndex({
      lines: ['- [ ] Same task', '- [ ] Same task'],
      candidateIndexes: [1],
      targetTexts: ['Same task'],
      exactTaskText: 'Same task',
      exactLineIdentity: getTaskLineIdentity('- [ ] Same task'),
    }),
    -1,
    'duplicate exact source lines remain ambiguous even when one occupies the old line',
  );

  const emptyTitleLine = '- [ ] [status:: working] [priority:: high]';
  assert.equal(
    resolveTaskLineIndex({
      lines: ['# Tasks', emptyTitleLine],
      candidateIndexes: [1],
      targetTexts: ['working'],
      exactTaskText: '',
      exactLineIdentity: getTaskLineIdentity(emptyTitleLine),
    }),
    1,
    'a title-less Table task still resolves from its exact source-line identity',
  );
  assert.equal(
    resolveTaskLineIndex({
      lines: ['# Tasks', emptyTitleLine],
      candidateIndexes: [0],
      targetTexts: ['working'],
      exactTaskText: '',
    }),
    1,
    'a legacy title-less Table row falls back only to a unique empty canonical title',
  );

  assert.deepEqual(
    buildTaskLineCandidateIndexes({ lineCount: 20, renderedLine: '13' }),
    [13],
    'native rendered line metadata remains zero-based',
  );
  assert.equal(
    resolveTaskLineIndex({
      lines,
      candidateIndexes: [1],
      targetTexts: ['Wait for mobile reproduction'],
    }),
    3,
    'non-Table surfaces retain unique descendant-text fallback behavior',
  );
  assert.equal(
    resolveTaskLineIndex({
      lines: ['- [ ] Same task', '- [/] Same task'],
      candidateIndexes: [],
      targetTexts: ['Same task'],
    }),
    -1,
    'non-Table descendant-text fallback remains fail-closed when ambiguous',
  );
  assert.equal(
    resolveTaskLineIndex({
      lines: ['- [ ]'],
      candidateIndexes: [0],
      targetTexts: [],
    }),
    0,
    'a blank non-Table task still resolves through exact line metadata when no search text exists',
  );
  assert.equal(
    getTaskLineIdentity('- [ ] CRLF task\r'),
    getTaskLineIdentity('- [ ] CRLF task'),
    'source-line fingerprints are stable across LF and CRLF splitting',
  );
  assert.match(logBaseViewSource, /row\.dataset\.taskText = getTaskDisplayTitle\(entry\.line\)/);
  assert.match(logBaseViewSource, /row\.dataset\.taskLineIdentity = getTaskLineIdentity\(entry\.line\)/);
  assert.match(serviceSource, /const renderedTaskIdentity = this\.getRenderedTaskIdentity\(taskEl\)/);
  assert.match(serviceSource, /sourceEl && sourceEl !== taskEl && renderedTaskIdentity == null/);
  assert.match(serviceSource, /renderedLine: taskEl\.dataset\.tpsGcmContext === 'table-task' \? null : renderedLine/);
  assert.doesNotMatch(serviceSource, /add\(pluginLine, false\)/);
});

test('TPS List task rows relocate only by their exact rendered line identity', async () => {
  const { getTaskLineIdentity, resolveTaskLineIndex } = await importTaskLineResolutionUtility();
  const renderedLine = '- [ ] Buy';
  const shiftedLines = [
    '- [ ] Buy milk',
    renderedLine,
  ];

  assert.equal(
    resolveTaskLineIndex({
      lines: shiftedLines,
      candidateIndexes: [0],
      targetTexts: [],
      exactTaskText: 'Buy',
      exactLineIdentity: getTaskLineIdentity(renderedLine),
      requireExactLineIdentity: true,
    }),
    1,
    'a near-title insertion at the stale coordinate must not receive the rendered task action',
  );
  assert.equal(
    resolveTaskLineIndex({
      lines: [renderedLine, renderedLine],
      candidateIndexes: [0],
      targetTexts: [],
      exactTaskText: 'Buy',
      exactLineIdentity: getTaskLineIdentity(renderedLine),
      requireExactLineIdentity: true,
    }),
    -1,
    'indistinguishable rendered source lines must remain ambiguous',
  );
  assert.equal(
    resolveTaskLineIndex({
      lines: ['- [ ] Buy'],
      candidateIndexes: [0],
      targetTexts: [],
      exactTaskText: 'Buy',
      requireExactLineIdentity: true,
    }),
    -1,
    'a TPS List row without its rendered fingerprint must fail closed',
  );
  assert.match(serviceSource, /surface !== 'tps-table' && surface !== 'tps-list'/);
  assert.match(serviceSource, /requireExactLineIdentity: taskElSurface\(taskEl\) === 'tps-list'/);
});

test('task-menu checkbox mutations reject a relocated same-title task whose workflow token changed', async () => {
  const [{ findCurrentTaskLineIndex }, { isTaskCheckboxWorkflowTokenCurrent }] = await Promise.all([
    importTaskBlockMoveUtility(),
    importTaskCheckboxWorkflowUtility(),
  ]);
  const capturedLine = '- [ ] Same title';
  const liveLine = '- [x] Same title';
  const resolved = findCurrentTaskLineIndex([liveLine], 0, capturedLine, 'Same title');
  let writes = 0;
  if (resolved >= 0 && isTaskCheckboxWorkflowTokenCurrent('[x]', '[ ]')) writes += 1;

  assert.equal(resolved, 0, 'the legacy unique-title resolver still relocates the task');
  assert.equal(writes, 0, 'the token compare-and-swap must block the stale checkbox write');
  assert.equal(isTaskCheckboxWorkflowTokenCurrent('[X]', '[x]'), true, 'canonical checked spellings are one workflow token');
  assert.match(
    serviceSource,
    /options\.checkboxMutation === true[\s\S]{0,120}!isTaskCheckboxWorkflowTokenCurrent\(currentParsed\.token, expectedCheckboxToken\)[\s\S]{0,40}return content/u,
  );
});

test('optimistic task-menu status labels preserve the pre-click token for the atomic write guard', async () => {
  const { isTaskCheckboxWorkflowTokenCurrent } = await importTaskCheckboxWorkflowUtility();
  const context = { checkboxToken: '[ ]' };
  const expectedCheckboxToken = context.checkboxToken;
  context.checkboxToken = '[x]';

  assert.equal(
    isTaskCheckboxWorkflowTokenCurrent('[ ]', context.checkboxToken),
    false,
    'the optimistic display token is not the expected source token',
  );
  assert.equal(
    isTaskCheckboxWorkflowTokenCurrent('[ ]', expectedCheckboxToken),
    true,
    'the captured pre-click token permits the unchanged source mutation',
  );
  assert.match(serviceSource, /expectedCheckboxToken\?: string/u);
  assert.match(
    serviceSource,
    /const expectedCheckboxToken = options\.checkboxMutation === true[\s\S]{0,120}options\.expectedCheckboxToken \|\| context\.checkboxToken/u,
  );
  assert.ok(
    (serviceSource.match(/this\.updateTaskStatus\([\s\S]{0,180}previousToken/gu) || []).length >= 2,
    'mapped and custom context-menu status changes must pass the pre-click token to the shared status writer',
  );
  assert.doesNotMatch(
    serviceSource,
    /!isTaskCheckboxWorkflowTokenCurrent\(currentParsed\.token, context\.checkboxToken\)/u,
  );
});

test('duplicate mobile status selections share one in-flight task mutation', async () => {
  const pending = new Map();
  let writes = 0;
  let finishWrite;
  const write = new Promise((resolve) => {
    finishWrite = resolve;
  });
  const run = (key) => {
    const existing = pending.get(key);
    if (existing) return existing;
    writes += 1;
    const mutation = write.finally(() => {
      if (pending.get(key) === mutation) pending.delete(key);
    });
    pending.set(key, mutation);
    return mutation;
  };

  const first = run('Daily/2026-08-11.md:4:[/]');
  const duplicate = run('Daily/2026-08-11.md:4:[/]');
  assert.equal(first, duplicate, 'the duplicate caller must await the original status write');
  assert.equal(writes, 1, 'only one vault mutation may start for the same task and destination status');
  finishWrite(true);
  await Promise.all([first, duplicate]);
  assert.equal(pending.size, 0, 'the in-flight registry clears after the durable write settles');

  assert.match(serviceSource, /private pendingTaskStatusMutations = new Map<string, Promise<boolean>>\(\)/u);
  assert.match(
    serviceSource,
    /const pending = this\.pendingTaskStatusMutations\.get\(mutationKey\);[\s\S]{0,220}status-write:duplicate-coalesced[\s\S]{0,180}return pending;/u,
  );
  assert.match(
    serviceSource,
    /this\.updateTaskLine\([\s\S]{0,420}\.finally\(\(\) => \{[\s\S]{0,220}delete\(mutationKey\)/u,
  );
});

test('mobile task and note editors share the keyboard-aware overlay contract', async () => {
  const { computeOverlayPlacement } = await importMobileOverlayUtility();
  const placement = computeOverlayPlacement(
    { left: 0, top: 0, width: 390, height: 360 },
    { left: 20, top: 500, bottom: 540 },
    260,
    { maxWidth: 480 },
  );
  assert.deepEqual(placement, {
    left: 12,
    top: 88,
    width: 366,
    maxHeight: 336,
    compact: true,
  });
  assert.match(serviceSource, /new KeyboardAwareOverlay\(card, anchorEl/);
  assert.match(persistentMenuSource, /new KeyboardAwareOverlay\(popover, anchorEl/);
  assert.match(mobileOverlaySource, /window\.visualViewport\?\.addEventListener\('resize'/);
  assert.match(mobileOverlaySource, /const REPOSITION_DELAYS = \[0, 80, 220, 420\]/);
  assert.match(mobileOverlaySource, /const compactBottomSheet = forceCompact && this\.options\.compactBottomSheet !== false/);
  assert.match(mobileOverlaySource, /if \(!this\.anchor\.isConnected && !compactBottomSheet\) return/);
  assert.match(mainSource, /this\.register\(installVisibleViewportContract\(\)\)/);
  assert.match(pluginStylesSource, /\.tps-keyboard-aware-overlay\s*\{/);
  assert.match(pluginStylesSource, /--tps-visible-viewport-height/);
  assert.match(pluginStylesSource, /body\.is-mobile \.modal:is\(\.mod-tps-gcm, \.tps-keyboard-aware-modal\)/);
  assert.match(pluginStylesSource, /\.tps-gcm-task-editor-actions\s*\{[\s\S]*position:\s*sticky/);
});

test('mobile overlay intersects stale visual and layout viewport dimensions', async () => {
  const { computeOverlayPlacement, getVisibleViewport } = await importMobileOverlayUtility();
  const staleVisualViewport = getVisibleViewport({
    innerWidth: 390,
    innerHeight: 360,
    visualViewport: { offsetLeft: 0, offsetTop: 0, width: 390, height: 844 },
  });
  assert.deepEqual(staleVisualViewport, { left: 0, top: 0, width: 390, height: 360 });

  const staleLayoutViewport = getVisibleViewport({
    innerWidth: 390,
    innerHeight: 844,
    visualViewport: { offsetLeft: 0, offsetTop: 24, width: 390, height: 336 },
  });
  assert.deepEqual(staleLayoutViewport, { left: 0, top: 24, width: 390, height: 336 });

  const offsetIntersection = getVisibleViewport({
    innerWidth: 390,
    innerHeight: 360,
    visualViewport: { offsetLeft: 10, offsetTop: 24, width: 390, height: 844 },
  });
  assert.deepEqual(offsetIntersection, { left: 10, top: 24, width: 380, height: 336 });

  const placement = computeOverlayPlacement(
    staleVisualViewport,
    { left: 20, top: 500, bottom: 540 },
    300,
    { maxWidth: 480 },
    true,
  );
  assert.deepEqual(placement, {
    left: 12,
    top: 48,
    width: 366,
    maxHeight: 336,
    compact: true,
  });
  assert.ok(placement.top + Math.min(300, placement.maxHeight) <= 348);
});

test('mobile overlay clamps frozen viewport APIs to the native keyboard boundary', async () => {
  const {
    applyNativeKeyboardShow,
    clearNativeKeyboard,
    computeOverlayPlacement,
    getVisibleViewport,
    readNativeKeyboardHeight,
    resetNativeKeyboard,
    seedNativeKeyboardBaseline,
  } = await importMobileOverlayUtility();
  const frozenWindow = {
    innerWidth: 390,
    innerHeight: 844,
    visualViewport: { offsetLeft: 0, offsetTop: 0, width: 390, height: 844 },
  };
  const nativeKeyboard = { height: 0, baselineHeight: null, baselineWidth: null };

  assert.equal(readNativeKeyboardHeight({ keyboardHeight: 340 }), 340);
  assert.equal(readNativeKeyboardHeight({ detail: { keyboardHeight: 340 } }), 340);
  assert.equal(readNativeKeyboardHeight({ keyboardHeight: 0 }), 0);
  assert.equal(readNativeKeyboardHeight({}), null);
  assert.deepEqual(seedNativeKeyboardBaseline(nativeKeyboard, frozenWindow), {
    left: 0,
    top: 0,
    width: 390,
    height: 844,
  });
  assert.equal(applyNativeKeyboardShow(nativeKeyboard, { keyboardHeight: 340 }, frozenWindow), true);
  assert.deepEqual(nativeKeyboard, { height: 340, baselineHeight: 844, baselineWidth: 390 });
  assert.deepEqual(
    getVisibleViewport(frozenWindow, nativeKeyboard),
    { left: 0, top: 0, width: 390, height: 504 },
  );
  const keyboardSafePlacement = computeOverlayPlacement(
    getVisibleViewport(frozenWindow, nativeKeyboard),
    { left: 20, top: 500, bottom: 540 },
    305,
    { maxWidth: 480 },
    true,
  );
  assert.deepEqual(keyboardSafePlacement, {
    left: 12,
    top: 187,
    width: 366,
    maxHeight: 480,
    compact: true,
  });
  assert.ok(keyboardSafePlacement.top + 305 <= 504);

  const alreadyShrunkWindow = {
    innerWidth: 390,
    innerHeight: 504,
    visualViewport: { offsetLeft: 0, offsetTop: 0, width: 390, height: 504 },
  };
  assert.equal(applyNativeKeyboardShow(nativeKeyboard, { detail: { keyboardHeight: 340 } }, alreadyShrunkWindow), true);
  assert.deepEqual(nativeKeyboard, { height: 340, baselineHeight: 844, baselineWidth: 390 });
  assert.deepEqual(
    getVisibleViewport(alreadyShrunkWindow, nativeKeyboard),
    { left: 0, top: 0, width: 390, height: 504 },
  );

  const pannedShrunkWindow = {
    innerWidth: 390,
    innerHeight: 844,
    visualViewport: { offsetLeft: 0, offsetTop: 340, width: 390, height: 504 },
  };
  assert.deepEqual(
    getVisibleViewport(pannedShrunkWindow, nativeKeyboard),
    { left: 0, top: 340, width: 390, height: 504 },
  );

  const lateState = { height: 0, baselineHeight: null, baselineWidth: null };
  assert.equal(applyNativeKeyboardShow(lateState, { keyboardHeight: 340 }, alreadyShrunkWindow), false);
  assert.deepEqual(lateState, { height: 340, baselineHeight: null, baselineWidth: null });
  seedNativeKeyboardBaseline(lateState, alreadyShrunkWindow);
  assert.deepEqual(lateState, { height: 340, baselineHeight: null, baselineWidth: null });
  assert.deepEqual(
    getVisibleViewport(alreadyShrunkWindow, lateState),
    { left: 0, top: 0, width: 390, height: 504 },
  );

  const landscapeWindow = {
    innerWidth: 844,
    innerHeight: 390,
    visualViewport: { offsetLeft: 0, offsetTop: 0, width: 844, height: 390 },
  };
  seedNativeKeyboardBaseline(nativeKeyboard, landscapeWindow);
  assert.deepEqual(nativeKeyboard, { height: 340, baselineHeight: 390, baselineWidth: 844 });
  assert.deepEqual(
    getVisibleViewport(landscapeWindow, nativeKeyboard),
    { left: 0, top: 0, width: 844, height: 50 },
  );
  assert.equal(applyNativeKeyboardShow(nativeKeyboard, { keyboardHeight: 220 }, landscapeWindow), true);
  assert.deepEqual(nativeKeyboard, { height: 220, baselineHeight: 390, baselineWidth: 844 });
  assert.deepEqual(
    getVisibleViewport(landscapeWindow, nativeKeyboard),
    { left: 0, top: 0, width: 844, height: 170 },
  );

  const rotatedAfterResize = { height: 340, baselineHeight: 844, baselineWidth: 390 };
  const resizedLandscapeWindow = {
    innerWidth: 844,
    innerHeight: 170,
    visualViewport: { offsetLeft: 0, offsetTop: 0, width: 844, height: 170 },
  };
  seedNativeKeyboardBaseline(rotatedAfterResize, resizedLandscapeWindow);
  assert.deepEqual(rotatedAfterResize, { height: 220, baselineHeight: 390, baselineWidth: 844 });
  assert.deepEqual(
    getVisibleViewport(resizedLandscapeWindow, rotatedAfterResize),
    { left: 0, top: 0, width: 844, height: 170 },
  );

  const eventAfterResize = { height: 340, baselineHeight: 844, baselineWidth: 390 };
  assert.equal(
    applyNativeKeyboardShow(eventAfterResize, { keyboardHeight: 220 }, resizedLandscapeWindow),
    true,
  );
  assert.deepEqual(eventAfterResize, { height: 220, baselineHeight: 390, baselineWidth: 844 });
  assert.deepEqual(
    getVisibleViewport(resizedLandscapeWindow, eventAfterResize),
    { left: 0, top: 0, width: 844, height: 170 },
  );

  seedNativeKeyboardBaseline(nativeKeyboard, frozenWindow);
  assert.deepEqual(nativeKeyboard, { height: 390, baselineHeight: 844, baselineWidth: 390 });
  assert.deepEqual(
    getVisibleViewport(frozenWindow, nativeKeyboard),
    { left: 0, top: 0, width: 390, height: 454 },
  );

  assert.equal(applyNativeKeyboardShow(nativeKeyboard, { keyboardHeight: 0 }, frozenWindow), true);
  assert.deepEqual(nativeKeyboard, { height: 0, baselineHeight: 844, baselineWidth: 390 });

  clearNativeKeyboard(nativeKeyboard);
  assert.deepEqual(nativeKeyboard, { height: 0, baselineHeight: 844, baselineWidth: 390 });
  seedNativeKeyboardBaseline(nativeKeyboard, frozenWindow);
  assert.deepEqual(nativeKeyboard, { height: 0, baselineHeight: 844, baselineWidth: 390 });
  assert.equal(applyNativeKeyboardShow(nativeKeyboard, {}, frozenWindow), false);

  applyNativeKeyboardShow(nativeKeyboard, { keyboardHeight: 340 }, frozenWindow);
  resetNativeKeyboard(nativeKeyboard);
  assert.deepEqual(nativeKeyboard, { height: 0, baselineHeight: null, baselineWidth: null });
  seedNativeKeyboardBaseline(nativeKeyboard, frozenWindow);
  assert.deepEqual(nativeKeyboard, { height: 0, baselineHeight: 844, baselineWidth: 390 });
});

test('custom Base note links use Hover Editor while task bodies stay task-scoped', () => {
  assert.match(mainSource, /private registerBasesLinkPreviewHandler\(\): void/);
  assert.match(mainSource, /openBaseNotePreviewFromClick\(evt: MouseEvent, file: TFile, anchorEl: HTMLElement, force = false\): boolean/);
  assert.match(mainSource, /return this\.settings\.enableBasesForcedLinkPreview === true/);
  assert.doesNotMatch(mainSource, /evt\.button !== 0 \|\| evt\.defaultPrevented/);
  assert.match(mainSource, /this\.openBaseLinkInHoverEditor\(file, anchorEl\)/);
  assert.match(mainSource, /this\.persistentMenuManager\.showBaseLinkEditablePreview\(file, anchorEl\)/);
  assert.match(mainSource, /BasesLinkPreview', 'local-editor-open'/);
  assert.match(logBaseViewSource, /this\.plugin\.openBaseNotePreviewFromClick\(event, entry\.file, link, true\)/);
  assert.match(mainSource, /\.tps-list-native-row--note\[data-path\]/);
  assert.match(mainSource, /\.tps-list-native-property--source\.internal-link/);
  assert.match(mainSource, /\.tps-log-base-row a\.internal-link/);
  assert.match(mainSource, /if \(taskSurface && !explicitNoteLink\) return null/);
});

test('task checkbox status menu labels the current option explicitly for mobile sheets', () => {
  assert.match(serviceSource, /const setSelectedToken = \(token: string\) =>/);
  assert.match(serviceSource, /setSelectedToken\(mapping\.checkboxState\)/);
  assert.match(serviceSource, /setTitle\(selected \? `\$\{label\} — Selected` : label\)/);
  assert.match(serviceSource, /entry\.item\.setChecked\(selected\)/);
  assert.match(linkedSubitemCheckboxSource, /const setSelectedStatus = \(selectedStatus: string\) =>/);
  assert.match(linkedSubitemCheckboxSource, /setSelectedStatus\(status\)/);
  assert.match(linkedSubitemCheckboxSource, /`\$\{status\} — Selected`/);
});

test('obsolete settings are removed from active GCM settings and writes', () => {
  for (const source of [settingsTabSource, constantsSource, typesSource]) {
    assert.doesNotMatch(source, /defaultSubitemsPath|defaultNewSubitemStatus|defaultNewSubitemPriority/);
    assert.doesNotMatch(source, /seedNewSubitemVisualMetadata|useNativePropertiesUnderTitle/);
    assert.doesNotMatch(source, /writeBasesIconFields|basesIconMarkdownField|basesIconUriField/);
  }
  assert.doesNotMatch(settingsTabSource, /Default subitems path|Default new subitem status|Default new subitem priority/);
  assert.doesNotMatch(settingsTabSource, /Seed new subitem visual metadata|Use native properties under title/);
  assert.doesNotMatch(settingsTabSource, /Bases Icon Fields|Write Bases icon fields/);
  assert.match(subitemCreationSource, /return parentFile\.parent\?\.path \|\| '\/'/);
  assert.match(subitemCreationSource, /options\?\.seedVisualMetadata === true/);
  assert.doesNotMatch(notebookRuleSettingsSource, /writeBasesIconFields|basesIconMarkdownField|basesIconUriField/);
  assert.doesNotMatch(notebookRuleServiceSource, /iconDisplay|iconDisplayUri/);
});

test('GCM task-line writes use configured timestamp keys', () => {
  for (const source of [
    createTaskServiceSource,
    aiAssistedTaskServiceSource,
    taskApiSource,
    serviceSource,
    taskCheckboxHandlerSource,
    dailyInboxLineSource,
    timeTrackingSource,
  ]) {
    const calls = source.match(/updateTaskLineTimestamps\([\s\S]*?\n\s*}\)/g) || [];
    assert.ok(calls.length > 0, 'expected timestamp mutation callsites');
    for (const call of calls) {
      assert.match(call, /enabled: this\.plugin\.settings\.autoSyncFileTimestamps === true/);
    }
  }
  assert.match(createTaskServiceSource, /dateCreatedFrontmatterKey/);
  assert.match(createTaskServiceSource, /markCreated: true/);
  assert.match(createTaskServiceSource, /markModified: true/);
});

test('note scheduling stores allDay only when true', () => {
  const menuControllerSource = readFileSync(new URL('../src/menu/menu-controller.ts', import.meta.url), 'utf8');
  assert.match(menuControllerSource, /if \(result\.allDay\) entry\.frontmatter\.allDay = true;/);
  assert.match(menuControllerSource, /else delete entry\.frontmatter\.allDay;/);
  assert.doesNotMatch(menuControllerSource, /entry\.frontmatter\.allDay = false/);
});

test('GCM intercepts Kanban and Calendar task rows before the note file menu', () => {
  assert.match(serviceSource, /KANBAN_TASK_SELECTOR/);
  assert.match(serviceSource, /data-tps-gcm-context="kanban-task"/);
  assert.match(serviceSource, /data-tps-gcm-context="calendar-task"/);
  assert.match(serviceSource, /tps-calendar-task-entry/);
  assert.match(serviceSource, /evt\.stopImmediatePropagation\(\)/);
  assert.match(serviceSource, /showMenu\(context, taskEl, evt\.pageX, evt\.pageY\)/);
  assert.match(serviceSource, /this\.setTaskStatusCheckboxState\(line, mapping\.checkboxState\)/);
  assert.match(serviceSource, /updateTaskCompletedDateForCheckboxState\(nextLine, nextParsed\?\.marker/);
  assert.match(serviceSource, /setInlineFieldValueOnTaskLine\(line, property\.key/);
  assert.match(serviceSource, /type: 'task'/);
  assert.match(serviceSource, /shouldPromptForTimedCalendarTask/);
  assert.match(serviceSource, /TaskTimerScheduledConflictModal/);
  assert.match(serviceSource, /duplicateTaskBelowForTimer/);
  assert.match(serviceSource, /getTaskElementSearchTexts/);
  assert.match(
    serviceSource,
    /\.\.\.directTargetTexts,[\s\S]*?\.\.\.this\.getTaskElementSearchTexts\(taskEl\)/u,
    'a clicked tag/property fragment must retain the full task-row text as a resolution fallback',
  );
  assert.match(serviceSource, /getTaskSearchTextVariants/);
  assert.match(serviceSource, /all day:\\s\*\(\?:true\|false\)/);
  assert.match(taskLineResolutionSource, /targetTexts\.some/);
  assert.match(mainSource, /new TaskLineContextMenuService\(this\)/);
  assert.match(mainSource, /taskLineContextMenuService\.handleContextMenu\(evt\)/);
  assert.match(mainSource, /if \(this\.taskLineContextMenuService\.handleContextMenu\(evt\)\) return;/);
});

test('task menus expose the plain task title while keeping edits task-scoped', () => {
  const taskMenuSource = serviceSource.match(/addTaskLineMenuItems[\s\S]*?private addTaskStatusMenu/)?.[0] || '';
  const taskTitlePromptSource = serviceSource.match(/private promptTaskTitle[\s\S]*?private promptInlineValue/)?.[0] || '';

  assert.match(taskMenuSource, /setTitle\(`Title: \$\{context\.title \|\| '\(untitled task\)'\}`\)/);
  assert.match(taskMenuSource, /setSection\('tps-title'\)/);
  assert.match(taskMenuSource, /onClick\(\(\) => this\.promptTaskTitle\(context\)\)/);
  assert.doesNotMatch(taskMenuSource, /Rename Title/);
  assert.match(taskTitlePromptSource, /'TaskLineContextMenu', 'rename:prompt'/);
  assert.match(taskTitlePromptSource, /surface: context\.isCalendarTask \? 'calendar' : 'task-line'/);
  assert.match(taskTitlePromptSource, /new TextInputModal\(this\.plugin\.app, 'Task title'/);
  assert.match(taskTitlePromptSource, /setTaskTitle\(line, value\)/);
});

test('checkbox long-press menus append reusable task-line actions', () => {
  assert.match(taskCheckboxHandlerSource, /addTaskLineMenuItems\(menu, taskLineContext/);
  assert.match(taskCheckboxHandlerSource, /toTaskLineContext\(context\)/);
  assert.match(taskCheckboxHandlerSource, /lineNumber: context\.lineNumber \+ 1/);
  assert.match(taskCheckboxHandlerSource, /lineIndex: context\.lineNumber/);
  assert.match(taskCheckboxHandlerSource, /handleContextMenu\(evt: MouseEvent\): boolean/);
  assert.doesNotMatch(taskCheckboxHandlerSource, /async handleContextMenu\(evt: MouseEvent\)/);
  assert.match(taskCheckboxHandlerSource, /getTaskDisplayTitle\(rawLine\) \|\| rawLine/);
  assert.match(mainSource, /if \(this\.taskCheckboxHandler\.handleContextMenu\(evt\)\) return;\s*if \(this\.taskLineContextMenuService\.handleContextMenu\(evt\)\) return;/);
  assert.match(serviceSource, /addTaskLineMenuItems\(/);
  assert.match(serviceSource, /includeStatus = options\.includeStatus !== false/);
  assert.match(serviceSource, /includeNoteActions = options\.includeNoteActions !== false/);
  assert.match(serviceSource, /if \(includeNoteActions\) \{/);
  assert.match(serviceSource, /const sourceNoteTitle = this\.plugin\.noteTitleRenderService\.getDisplayTitle\(context\.file\) \|\| context\.file\.basename/);
  assert.match(serviceSource, /setTitle\(`Move task from \$\{sourceNoteTitle\}\.\.\.`\)/);
  assert.match(serviceSource, /setTitle\('Move selected to note\.\.\.'\)/);
  assert.doesNotMatch(serviceSource, /setTitle\('Archive item in place'\)/);
  assert.doesNotMatch(serviceSource, /setTitle\('Archive selected in place'\)/);
  assert.doesNotMatch(serviceSource, /setTitle\('Transfer item to note\.\.\.'\)/);
});

test('inline task checkboxes can start task-line drags for calendar drops', () => {
  assert.match(dragServiceSource, /TPS_TASK_LINE_MIME = 'application\/x-tps-task-line'/);
  assert.match(dragServiceSource, /TPS_TASK_LINE_POINTER_DROP_EVENT = 'tps-task-line-pointer-drop'/);
  assert.match(dragServiceSource, /\.tps-gcm-linked-subitem-checkbox/);
  assert.match(dragServiceSource, /const context = this\.resolveTaskLineContext\(checkboxEl\);/);
  assert.match(dragServiceSource, /checkboxEl\.setAttribute\('draggable', 'true'\)/);
  assert.match(dragServiceSource, /evt\.dataTransfer\.setData\(TPS_TASK_LINE_MIME, payloadRaw\)/);
  assert.match(dragServiceSource, /document\.dispatchEvent\(dropEvent\)/);
  assert.match(dragServiceSource, /targetEl\.closest\('\.cm-line, \.tps-gcm-linked-subitem-cm-line, \[data-line\]'\)/);
  assert.doesNotMatch(dragServiceSource, /closest\('\.tps-gcm-linked-subitem-task, \.tps-gcm-linked-subitem-checkbox, \.tps-gcm-checklist-toggle'\)\) return/);
  assert.match(dragServiceSource, /await this\.plugin\.taskApiService\.move\(/);
  assert.match(dragServiceSource, /sourcePolicy: 'configured-daily-note'/);
  assert.match(dragServiceSource, /resolution: 'exact-or-identity'/);
  assert.doesNotMatch(dragServiceSource, /this\.plugin\.app\.vault\.process\(sourceFile/);
});

test('task menu can move a task to another file append-only without losing the source task first', () => {
  const taskMenuSource = serviceSource.slice(
    serviceSource.indexOf('\n  addTaskLineMenuItems('),
    serviceSource.indexOf('private addInlineTagsMenu'),
  );
  const secondaryMenuStart = taskMenuSource.indexOf('menu.addSeparator()');
  const moveTaskIndex = taskMenuSource.indexOf('`Move task from ${sourceNoteTitle}...`');
  const openTaskIndex = taskMenuSource.indexOf("'Open task line'");

  assert.ok(secondaryMenuStart >= 0, 'task menu should retain its secondary action separator');
  assert.match(taskMenuSource, /menu\.addSeparator\(\);\s*menu\.addItem\(\(item\) => \{\s*item\s*\.setTitle\(`Move task from \$\{sourceNoteTitle\}\.\.\.`\)/);
  assert.ok(moveTaskIndex > secondaryMenuStart, 'move task should remain in the secondary action section');
  assert.ok(moveTaskIndex < openTaskIndex, 'move task should be the first secondary action');
  assert.match(serviceSource, /new FileSuggestModal\(this\.plugin\.app, async \(targetFile\) => \{/);
  assert.match(serviceSource, /await this\.plugin\.taskApiService\.move\(/);
  assert.match(serviceSource, /lineNumber: context\.lineIndex/);
  assert.match(serviceSource, /rawLine: context\.rawLine/);
  assert.match(serviceSource, /targetFile,/);
  assert.match(serviceSource, /sourcePolicy: 'configured-daily-note'/);
  assert.match(serviceSource, /dailyNoteTaskMoveSourceBehavior !== 'remove'/);
  assert.match(serviceSource, /removed it from the Daily Note/);
  assert.doesNotMatch(serviceSource, /private async rollbackTaskBlockFromTarget/);
  assert.doesNotMatch(serviceSource, /private isDailyNoteSourceFile/);
  assert.match(serviceSource, /marked the Daily Note record as migrated/);
});

test('task menu highlight targets task rows instead of broad rendered note containers', () => {
  const highlightSource = serviceSource.slice(
    serviceSource.indexOf('private resolveRenderedTaskElements'),
    serviceSource.indexOf('private isTaskHighlightElement'),
  );
  assert.match(serviceSource, /private isTaskHighlightElement\(element: HTMLElement\): boolean/);
  assert.match(serviceSource, /resolveDirectTaskHighlightHost\(sourceEl: HTMLElement\)/);
  assert.match(serviceSource, /resolveDirectTaskHighlightHost[\s\S]{0,500}\[data-tps-gcm-context="kanban-task"\]/);
  assert.match(serviceSource, /taskOrdinal\?: number/);
  assert.match(serviceSource, /taskOrdinal: this\.getTaskOrdinal\(lines, lineIndex\)/);
  assert.match(highlightSource, /\.tps-calendar-task-entry\[data-task-path\]\[data-task-line="\$\{context\.lineNumber\}"\]/);
  assert.match(highlightSource, /\.tps-kanban-card-task\[data-task-path\]\[data-task-line="\$\{context\.lineNumber\}"\]/);
  assert.match(highlightSource, /\.tps-kanban-task-card\[data-task-path\]\[data-task-line="\$\{context\.lineNumber\}"\]/);
  assert.match(highlightSource, /\[data-tps-gcm-context="calendar-task"\]\[data-task-line="\$\{context\.lineNumber\}"\]/);
  assert.match(highlightSource, /\[data-tps-gcm-context="kanban-task"\]\[data-task-line="\$\{context\.lineNumber\}"\]/);
  assert.match(highlightSource, /this\.highlightHostMatchesContext\(element, context\)/);
  assert.doesNotMatch(highlightSource, /data-task-line="\$\{context\.lineIndex\}"/);
  assert.match(highlightSource, /getRenderedTaskHighlightElements\(previewEl\)\[context\.taskOrdinal\]/);
  assert.doesNotMatch(highlightSource, /includes\(taskText\)|taskText\.includes/);
  assert.doesNotMatch(serviceSource, /resolveDirectTaskHighlightHost[\s\S]{0,500}li, \.cm-line/);
  assert.doesNotMatch(serviceSource, /getRenderedTaskHighlightElements[\s\S]{0,500}'[^']*li, \[data-task-path\]/);
  assert.doesNotMatch(serviceSource, /isTaskHighlightElement[\s\S]{0,500}(?<![\w.-])\[data-task-path\]\[data-task-line\]/);
  assert.doesNotMatch(serviceSource, /resolveDirectTaskHighlightHost[\s\S]{0,500}closest<HTMLElement>\([^)]*div/);
  assert.doesNotMatch(serviceSource, /querySelectorAll<HTMLElement>\(`[^`]*div\[data-line/);
  assert.doesNotMatch(serviceSource, /resolveRenderedTaskElements[\s\S]{0,1800}querySelectorAll<HTMLElement>\('[^']*li, div/);
  assert.doesNotMatch(pluginStylesSource, /,\s*\.tps-gcm-task-line-active\s*\{/);
  assert.doesNotMatch(pluginStylesSource, /,\s*\.tps-gcm-task-line-selected\s*\{/);
});

test('opening task lines reveals hidden completed rows before scrolling', () => {
  const openTaskLineSource = serviceSource.slice(
    serviceSource.indexOf('private async openTaskLine'),
    serviceSource.indexOf('private isTaskMenuProperty'),
  );
  assert.match(openTaskLineSource, /const lineIndex = this\.resolveLineIndex\(lines, context\)/);
  assert.match(openTaskLineSource, /typeof currentEditor\?\.getValue === 'function'/);
  assert.match(openTaskLineSource, /open-line:stale-target/);
  assert.match(openTaskLineSource, /hideCompletedCheckboxesService\?\.revealCompletedForFile\(context\.file\.path, lineIndex\)/);
  assert.match(openTaskLineSource, /await this\.delay\(90\)/);
  assert.match(openTaskLineSource, /openFileInLeaf\(/);
  assert.match(openTaskLineSource, /scrollIntoView\?\.\(\{ from: \{ line: lineIndex/);
});

test('task block move helpers preserve nested content like extract selection workflows', async () => {
  const {
    extractTaskBlock,
    findCurrentTaskLineIndex,
    insertTaskBlockAtEnd,
    insertTaskBlockAfterFrontmatter,
    removeTaskBlockFromContent,
    replaceTaskBlockInContent,
    splitContent,
    buildDailyNoteScratchpadMovedTaskBlock,
  } = await importTaskBlockMoveUtility();
  const source = [
    'Before',
    '- [ ] parent task [scheduled:: 2026-06-03 10:00:00]',
    '  - nested note',
    '  - [ ] nested checkbox',
    '    - deeper detail',
    '- [ ] sibling task',
    '',
  ].join('\n');
  const parts = splitContent(source);
  const lineIndex = findCurrentTaskLineIndex(parts.lines, 1, '- [ ] parent task [scheduled:: 2026-06-03 10:00:00]', 'parent task');
  assert.equal(lineIndex, 1);
  const block = extractTaskBlock(parts.lines, lineIndex);
  assert.deepEqual(block.lines, [
    '- [ ] parent task [scheduled:: 2026-06-03 10:00:00]',
    '  - nested note',
    '  - [ ] nested checkbox',
    '    - deeper detail',
  ]);

  const removed = removeTaskBlockFromContent(source, 1, '- [ ] parent task [scheduled:: 2026-06-03 10:00:00]', 'parent task');
  assert.equal(removed.changed, true);
  assert.equal(removed.content, 'Before\n- [ ] sibling task\n');

  const target = '---\ntitle: Target\n---\n\nExisting body\n';
  assert.equal(
    insertTaskBlockAfterFrontmatter(target, block.lines).content,
    [
      '---',
      'title: Target',
      '---',
      '- [ ] parent task [scheduled:: 2026-06-03 10:00:00]',
      '  - nested note',
      '  - [ ] nested checkbox',
      '    - deeper detail',
      '',
      'Existing body',
      '',
    ].join('\n'),
  );
  assert.equal(
    insertTaskBlockAtEnd(target, block.lines).content,
    [
      '---',
      'title: Target',
      '---',
      '',
      'Existing body',
      '- [ ] parent task [scheduled:: 2026-06-03 10:00:00]',
      '  - nested note',
      '  - [ ] nested checkbox',
      '    - deeper detail',
      '',
    ].join('\n'),
  );

  assert.deepEqual(
    buildDailyNoteScratchpadMovedTaskBlock(block.lines, {
      targetPath: 'Projects/Target.md',
      movedAt: new Date(2026, 5, 26, 9, 8, 7),
    }),
    [
      '- [>] parent task [scheduled:: 2026-06-03 10:00:00] [migratedTo:: [[Projects/Target]]]',
      '  - nested note',
      '  - [ ] nested checkbox',
      '    - deeper detail',
    ],
  );
  const replaced = replaceTaskBlockInContent(
    source,
    1,
    '- [ ] parent task [scheduled:: 2026-06-03 10:00:00]',
    'parent task',
    buildDailyNoteScratchpadMovedTaskBlock(block.lines, {
      targetPath: 'Projects/Target.md',
      movedAt: new Date(2026, 5, 26, 9, 8, 7),
    }),
  );
  assert.equal(replaced.changed, true);
  assert.equal(
    replaced.content,
    [
      'Before',
      '- [>] parent task [scheduled:: 2026-06-03 10:00:00] [migratedTo:: [[Projects/Target]]]',
      '  - nested note',
      '  - [ ] nested checkbox',
      '    - deeper detail',
      '- [ ] sibling task',
      '',
    ].join('\n'),
  );
});

test('task time tracking targets task lines and does not fall back to note frontmatter for tasks', () => {
  assert.match(timeTrackingSource, /const type = input\?\.type === 'task' \? 'task' : 'note'/);
  assert.match(timeTrackingSource, /parseTaskLine\(line\)/);
  assert.match(timeTrackingSource, /createTaskTargetId\(file, lineNumber, line\)/);
  assert.match(timeTrackingSource, /ensureTaskLineTpsId\(file, lineNumber, line, title, tpsId\)/);
  assert.match(timeTrackingSource, /resolveTargetForRecord\(record, \{ storageFile \}\)/);
  assert.match(timeTrackingSource, /record\.targetType === 'task'/);
  assert.match(timeTrackingSource, /Skipped task schedule sync because the task line could not be resolved/);
  assert.match(timeTrackingSource, /syncTaskLineScheduledMetadata/);
  assert.match(timeTrackingSource, /findTaskLineIndex\(lines, lineNumber, targetId\)/);
  assert.match(timeTrackingSource, /readInlineFieldValue\(line, TPS_ID_FIELD\) \|\| readInlineFieldValue\(line, 'subitemId'\)/);
  assert.match(timeTrackingSource, /setInlineFieldValueOnTaskLine\(line, TPS_ID_FIELD, wanted\)/);
  assert.match(timeTrackingSource, /setInlineFieldValueOnTaskLine\(line, 'scheduled', scheduledValue\)/);
  assert.match(timeTrackingSource, /setInlineFieldValueOnTaskLine\(next, 'timeEstimate', String\(durationMinutes\)\)/);
  assert.match(timeTrackingSource, /withResolvedLineNumber\(updated, target\)/);
  assert.doesNotMatch(timeTrackingSource, /record\.targetType === 'task'[\s\S]{0,500}setValueCaseInsensitive\(frontmatter, 'scheduled'/);
});

test('time tracking does not schedule process run notes such as workouts', () => {
  assert.match(timeTrackingSource, /isProcessRunFrontmatter\(frontmatter\)/);
  assert.match(timeTrackingSource, /deleteValueCaseInsensitive\(frontmatter, 'scheduled'\)/);
  assert.match(timeTrackingSource, /runKind === 'run'/);
  assert.match(timeTrackingSource, /workflowKind === 'workflow'/);
  assert.match(timeTrackingSource, /kind === 'workout'/);
  assert.match(timeTrackingSource, /Boolean\(runType\)/);
  assert.match(timeTrackingSource, /Boolean\(workflowType\)/);
});

test('time tracking ignores archived running sessions by default', () => {
  assert.match(timeTrackingSource, /shouldIgnoreTimeTrackingPath\(path: string \| null \| undefined\): boolean/);
  assert.match(timeTrackingSource, /this\.plugin\.settings\.timeTrackingIgnoreArchivedFiles === false/);
  assert.match(timeTrackingSource, /this\.plugin\.getArchiveFolderPath\?\.\(\)/);
  assert.match(timeTrackingSource, /normalizedPath === archiveFolder \|\| normalizedPath\.startsWith\(`\$\{archiveFolder\}\/`\)/);
  assert.match(timeTrackingSource, /private async shouldIgnoreStoredSession\(stored: StoredSession\): Promise<boolean>/);
  assert.match(timeTrackingSource, /this\.shouldIgnoreTimeTrackingPath\(stored\.storageFile\.path\)/);
  assert.match(timeTrackingSource, /this\.shouldIgnoreTimeTrackingPath\(stored\.record\.sourcePath\)/);
  assert.match(timeTrackingSource, /return this\.shouldIgnoreTimeTrackingPath\(target\?\.file\.path\)/);
  assert.match(timeTrackingSource, /if \(await this\.shouldIgnoreStoredSession\(session\)\) continue/);
});

test('daily note calendar popover includes scheduled task lines and note task jump list', () => {
  assert.match(persistentMenuSource, /collectScheduledTasksForCalendarItem/);
  assert.match(persistentMenuSource, /kind: 'task'/);
  assert.match(persistentMenuSource, /matchExternalEventForTaskMetadata/);
  assert.match(persistentMenuSource, /dataset\.tpsGcmContext/);
  assert.match(persistentMenuSource, /showNoteTasksPopover/);
  assert.match(persistentMenuSource, /collectTasksInFile/);
  assert.match(persistentMenuSource, /openTaskLine\(sourceFile, task\.lineNumber, task\.completed\)/);
  assert.match(persistentMenuSource, /hideCompletedCheckboxesService\?\.revealCompletedForFile/);
  assert.match(persistentMenuSource, /await this\.delay\(90\)/);
  assert.match(persistentMenuSource, /bindCompletedTaskPreviewReveal/);
  assert.match(persistentMenuSource, /row\.addEventListener\('mouseenter', reveal\)/);
  assert.match(persistentMenuSource, /row\.addEventListener\('focus', reveal\)/);
});

test('daily note task scheduled inheritance is configurable and shared across task surfaces', () => {
  assert.match(constantsSource, /inheritUnscheduledTasksFromDailyNotes:\s*true/);
  assert.match(settingsTabSource, /Inherit Daily Note date for unscheduled tasks/);
  assert.match(ruleEngineSource, /getInheritedDailyNoteTaskScheduledValue/);
  assert.match(ruleEngineSource, /context\.lineType !== "task"/);
  assert.match(ruleEngineSource, /hasInheritedDailyNoteTaskScheduledValue\(field, context\)/);
  assert.match(persistentMenuSource, /resolveTaskScheduledValue\(this\.plugin\.app, this\.plugin\.settings, file, rawLine\)/);
  assert.match(serviceSource, /resolveTaskScheduledValue\(this\.plugin\.app, this\.plugin\.settings, context\.file, context\.rawLine\)/);
  assert.match(serviceSource, /maybePromptMoveScheduledDailyNoteTask\(context, result\.date\)/);
  assert.match(serviceSource, /DailyNoteTaskMovePromptModal/);
  assert.match(noteOperationSource, /findExistingDailyNoteForIsoDate\(this\.app, this\.plugin\.settings, isoDate\)/);
});

test('daily note creation reuses equivalent D/DD daily note paths before creating duplicates', () => {
  assert.match(dailyNoteScheduleSource, /export function findExistingDailyNoteForIsoDate/);
  assert.match(dailyNoteScheduleSource, /getDailyNotePathForIsoDate\(app, settings, wanted\)/);
  assert.match(dailyNoteScheduleSource, /parseDailyNoteFileDate\(app, settings, file\) === wanted/);
  assert.match(dailyNoteScheduleSource, /export function getDailyNoteScheduledValueForIsoDate/);
  assert.match(noteOperationSource, /findExistingDailyNoteForIsoDate\(this\.app, this\.plugin\.settings, isoDate\)/);
  assert.match(noteOperationSource, /normalizeCreatedDailyNote\([\s\S]{0,180}existingDailyNote[\s\S]{0,180}isoDate/);
  assert.match(noteOperationSource, /getDailyNoteScheduledValueForIsoDate\(isoDate\)/);
  assert.match(dailyNavSource, /noteOperationService\.ensureDailyNote\(`\$\{isoDate\} 00:00:00`\)/);
  assert.match(bulkEditSource, /findExistingDailyNoteForIsoDate\(this\.plugin\.app, this\.plugin\.settings, nextIsoDate\)/);
});

test('note-level recurrence skips configured daily notes instead of creating daily note instances', () => {
  assert.match(bulkEditSource, /async shouldSkipNoteLevelRecurrence\(file: TFile, scheduled\?: string\): Promise<boolean>/);
  assert.match(bulkEditSource, /private readonly dailyRecurrenceRule = 'FREQ=DAILY';/);
  assert.match(bulkEditSource, /normalizeRecurrenceRuleValue\(recurrenceRule: unknown\): string/);
  assert.match(bulkEditSource, /value\.toLowerCase\(\) === 'dailynote' \? this\.dailyRecurrenceRule : value/);
  assert.match(bulkEditSource, /const basenameCandidates = \[[\s\S]{0,180}stripDatePrefix\(stripDateSuffix\(file\.basename\)\)\.trim\(\)/);
  assert.match(bulkEditSource, /if \(this\.hasDailyNoteMarker\(frontmatter\)\) \{[\s\S]{0,160}return true;/);
  assert.match(bulkEditSource, /parseDateFromFilename\(file\.basename, format\)\.isValid\(\)/);
  assert.match(bulkEditSource, /normalizedBasename\.includes\(expectedBasename\.toLowerCase\(\)\) \|\| normalizedBasename\.includes\(scheduledIso\.toLowerCase\(\)\)/);
  assert.match(bulkEditSource, /if \(await this\.shouldSkipNoteLevelRecurrence\(file, fm\.scheduled\)\) continue;/);
  assert.match(bulkEditSource, /if \(await this\.shouldSkipNoteLevelRecurrence\(file, currentScheduled\)\) \{[\s\S]{0,520}applyRecurrenceDirectly\(file, this\.dailyRecurrenceRule, null\)[\s\S]{0,140}return false;/);
  assert.ok(
    bulkEditSource.indexOf('if (await this.shouldSkipNoteLevelRecurrence(file, currentScheduled))') <
    bulkEditSource.indexOf('const isTrackerRecurrence = this.isTrackerRecurrenceRule(recurrenceRule);'),
    'daily-note skip must happen before RRULE parsing',
  );
  assert.match(
    bulkEditSource,
    /const workflowStatus = this\.normalizeStatusValue\(this\.getWorkflowStatusValue\(fm\)\);[\s\S]{0,120}recurrenceStatuses\.includes\(workflowStatus\) && !\(await this\.shouldSkipNoteLevelRecurrence\(file, fm\.scheduled\)\)/,
  );
  assert.doesNotMatch(bulkEditSource, /return await this\.createNextDailyNoteRecurrenceInstance\(file, frontmatter, nextDate, recurrenceRule\)/);
  assert.match(readFileSync(new URL('../src/services/recurrence-service.ts', import.meta.url), 'utf8'), /isNoteLevelRecurrenceSkipped\(file, fm\)/);
  assert.match(fileNamingSource, /shouldSkipNoteLevelRecurrence\(liveFile, scheduled\)\) return "skipped"/);
});

test('daily-note-marked files are not renamed or title-synced by scheduled note naming', () => {
  assert.match(fileNamingSource, /private isDailyNoteFrontmatter\(frontmatter: Record<string, unknown> \| undefined \| null\): boolean/);
  assert.match(fileNamingSource, /private isProcessRunFrontmatter\(frontmatter: Record<string, unknown> \| undefined \| null\): boolean/);
  assert.match(fileNamingSource, /if \(this\.isProcessRunFrontmatter\(frontmatter\)\) return false;/);
  assert.match(fileNamingSource, /tag === 'type\/note\/daily' \|\| tag === 'dailynote'/);
  assert.match(fileNamingSource, /value === 'daily' \|\| value === 'note\/daily' \|\| value === 'type\/note\/daily'/);
  assert.match(bulkEditSource, /const title = typeof frontmatter\?\.title === "string" \? frontmatter\.title\.trim\(\) : "";/);
  assert.match(bulkEditSource, /if \(titleIsDailyNoteDate\) return true;/);
  assert.match(fileNamingSource, /this\.isDateOnlyBasename\(rawBasename\) \|\| this\.isConfiguredDailyNotePath\(liveFile\)/);
  assert.match(fileNamingSource, /this\.isDateOnlyBasename\(String\(liveFile\.basename\)\.trim\(\)\)[\s\S]{0,120}\|\| this\.isConfiguredDailyNotePath\(liveFile\)/);
  assert.match(bulkEditSource, /private isProcessRunFrontmatter\(frontmatter: Record<string, unknown> \| undefined\): boolean/);
  assert.match(bulkEditSource, /if \(this\.isProcessRunFrontmatter\(frontmatter\)\) return false;/);
});

test('recurrence template marker writes and detection are migrated', () => {
  assert.match(bulkEditSource, /isRecurrenceTemplateFrontmatter\(frontmatter: unknown\): boolean/);
  assert.match(bulkEditSource, /markRecurrenceTemplate\(frontmatter: Record<string, any>\): void/);
  assert.match(bulkEditSource, /setFrontmatterValueCaseInsensitive\(frontmatter, 'recurrenceTemplate', true\);/);
  assert.match(bulkEditSource, /clearLegacyRecurrenceTemplateMarker\(frontmatter\);/);
  assert.doesNotMatch(bulkEditSource, /setFrontmatterValueCaseInsensitive\(fmw, 'isRecurrenceTemplate', true\);/);
  assert.match(readFileSync(new URL('../src/services/recurrence-service.ts', import.meta.url), 'utf8'), /isRecurrenceTemplateFrontmatter\(cache\?\.frontmatter\)/);
  assert.match(readFileSync(new URL('../src/services/recurrence-service.ts', import.meta.url), 'utf8'), /isRecurrenceTemplateFrontmatter\(fm\)/);
});

test('date marker stripping handles configured pretty daily note dates', async () => {
  const { stripDatePrefix, stripDateSuffix, extractDatePrefix, extractDateSuffix } = await importDateSuffixUtility();
  assert.ok(dateSuffixSource.includes('const PRETTY_DATE_PATTERN = "[A-Za-z]+,?\\\\s+[A-Za-z]+\\\\s+\\\\d{1,2}(?:st|nd|rd|th)?[,]?\\\\s+\\\\d{4}";'));
  assert.equal(stripDateSuffix('Wed, Jun 03 2026 Wed, Jun 03 2026'), 'Wed, Jun 03 2026');
  assert.equal(stripDateSuffix('Planning Review of GCP App Support Thu, May 21 2026'), 'Planning Review of GCP App Support');
  assert.equal(stripDatePrefix('2026-06-03 Planning Review of GCP App Support'), 'Planning Review of GCP App Support');
  assert.equal(stripDatePrefix('Thu, May 21 2026 Planning Review of GCP App Support'), 'Planning Review of GCP App Support');
  assert.deepEqual(extractDateSuffix('Planning Review of GCP App Support Thu, May 21 2026'), {
    base: 'Planning Review of GCP App Support',
    dateStr: 'Thu, May 21 2026',
  });
  assert.deepEqual(extractDatePrefix('2026-06-03 Planning Review of GCP App Support'), {
    base: 'Planning Review of GCP App Support',
    dateStr: '2026-06-03',
  });
});

test('scheduled note filenames use sortable date prefixes without changing canonical titles', () => {
  assert.match(fileNamingSource, /const dateStr = scheduledDate\.format\('YYYY-MM-DD'\)/);
  assert.match(fileNamingSource, /return this\.sanitizeFilename\(`\$\{dateStr\} \$\{canonicalTitle\}`\)/);
  assert.match(fileNamingSource, /stripDatePrefix\(stripDateSuffix\(normalizedTitle\)\)/);
  assert.match(fileNamingSource, /extractDatePrefix\(nextTitle\)/);
  assert.match(fileNamingSource, /stripKnownDateMarker\(rawBasename, scheduledDate\)/);
  assert.match(fileNamingSource, /hasPersistedFrontmatterBlock\(liveFile\)/);
  assert.match(fileNamingSource, /persistedValues\.has\('scheduled'\) \? persistedValues\.get\('scheduled'\) : ''/);
  assert.doesNotMatch(fileNamingSource, /persistedValues\.get\('scheduled'\) \?\? fm\?\.scheduled/);
  assert.doesNotMatch(fileNamingSource, /persistedValues\.get\('scheduled'\) \?\? fm\.scheduled/);
});

test('create task command parses natural language schedule into task metadata', async () => {
  const { parseCreateTaskInput, buildCreatedTaskLine } = await importCreateTaskUtility();
  const parsed = parseCreateTaskInput('go for a run tomorrow at 5pm #health', new Date(2026, 5, 1, 12, 0, 0));

  assert.equal(parsed.detectedDateText.toLowerCase(), 'tomorrow at 5pm');
  assert.equal(parsed.title, 'go for a run #health');
  assert.equal(parsed.scheduledValue, '2026-06-02 17:00:00');
  assert.equal(parsed.allDay, false);
  assert.equal(
    buildCreatedTaskLine({
      title: parsed.title,
      checkboxMarker: ' ',
      priority: 'medium',
      scheduledValue: parsed.scheduledValue,
      allDay: parsed.allDay,
      timeEstimate: 30,
    }),
    '- [ ] go for a run #health [priority:: medium] [scheduled:: 2026-06-02 17:00:00] [timeEstimate:: 30]',
  );
});

test('create task command appends to today daily note and does not create task status keys', () => {
  assert.match(commandsSource, /id: 'create-task'/);
  assert.match(commandsSource, /name: 'Create task'/);
  assert.match(commandsSource, /plugin\.createTaskService\.openCreateTaskModal\(\)/);
  assert.match(mainSource, /createTaskService: CreateTaskService/);
  assert.match(mainSource, /new CreateTaskService\(this\)/);
  assert.match(createTaskServiceSource, /noteOperationService\.ensureDailyNote\([\s\S]{0,100}format\('YYYY-MM-DD'\)[\s\S]{0,40}00:00:00/);
  assert.match(createTaskServiceSource, /updateTaskLineTimestamps\(taskLine/);
  assert.match(createTaskServiceSource, /vault\.process\(targetFile, \(content\) => \{/);
  assert.match(createTaskServiceSource, /isLinkedSubitemSemanticCheckboxPlanCurrent\(/);
  assert.match(createTaskServiceSource, /return insertLineAfterFrontmatter\(content, insertedTaskLine\)/);
  assert.match(createTaskServiceSource, /surface: 'create-task-modal'/);
  assert.match(createTaskServiceSource, /ensureDirectTaskHistoryIdentity\(/);
  assert.match(createTaskServiceSource, /openCreateTaskModalWithCanonicalTarget/);
  assert.match(createTaskModalSource, /Natural language schedule text is parsed into the Scheduled field/);
  assert.match(createTaskModalSource, /parseCreateTaskInput\(this\.titleInput\?\.getValue\?\.\(\) \|\| ''\)/);
  assert.match(createTaskModalSource, /this\.previewEl\.createEl\('mark'/);
  assert.doesNotMatch(createTaskModalSource, /status::/i);
});

test('inline property suggest opens date pickers while retaining generic @@ insertion', () => {
  assert.match(inlinePropertySuggestSource, /action\?: 'insert' \| 'create'/);
  assert.match(inlinePropertySuggestSource, /Create "\$\{normalizedCreateKey\}"/);
  assert.match(inlinePropertySuggestSource, /createInlineProperty\(suggestion\.key\)/);
  assert.match(inlinePropertySuggestSource, /this\.plugin\.settings\.properties\.push/);
  assert.match(inlinePropertySuggestSource, /showWhen: 'populated'/);
  assert.match(inlinePropertySuggestSource, /this\.usesDatePicker\(suggestion\)/);
  assert.match(inlinePropertySuggestSource, /new ScheduledModal\(/);
  assert.match(inlinePropertySuggestSource, /context\.end\.ch === sourceLine\.length/);
  assert.match(inlinePropertySuggestSource, /sourceRevision\.trimEnd\(\)/);
  assert.match(inlinePropertySuggestSource, /currentLine !== sourceRevision/);
  assert.match(inlinePropertySuggestSource, /setInlineFieldValueOnLine\([\s\S]*?'timeEstimate'/);
  assert.match(inlinePropertySuggestSource, /setInlineFieldValueOnLine\([\s\S]*?'allDay'/);
  assert.match(inlinePropertySuggestSource, /showTimeDetails: false/);
  assert.match(inlinePropertySuggestSource, /const insertion = `\[\$\{suggestion\.key\}:: ]`/);
  assert.ok(
    inlinePropertySuggestSource.indexOf('this.usesDatePicker(suggestion)')
      < inlinePropertySuggestSource.indexOf('const insertion = `[${suggestion.key}:: ]`'),
    'datetime suggestions must route to the picker before generic text insertion',
  );
});

test('health workout inline properties render only compact set metrics', () => {
  assert.doesNotMatch(constantsSource, /key: 'exercise'|key: 'exercisePath'|key: 'workoutPlanPath'/);
  assert.match(mainSource, /LEGACY_HEALTH_CUSTOM_PROPERTY_IDS/);
  assert.match(mainSource, /'workout-exercise'/);
  assert.match(mainSource, /removeRetiredBundledCustomProperties/);
  assert.match(mainSource, /!id\.startsWith\('tps-health-'\) && !LEGACY_HEALTH_CUSTOM_PROPERTY_IDS\.has\(id\)/);
  assert.match(inlinePropertyDecorationSource, /HEALTH_WORKOUT_INLINE_KEYS/);
  assert.match(inlinePropertyDecorationSource, /HEALTH_WORKOUT_VISIBLE_INLINE_KEYS/);
  assert.match(inlinePropertyDecorationSource, /'exercise'/);
  assert.match(inlinePropertyDecorationSource, /'reps'/);
  assert.match(inlinePropertyDecorationSource, /'weight'/);
  assert.match(inlinePropertyDecorationSource, /'rpe'/);
  assert.match(inlinePropertyDecorationSource, /'rest'/);
  assert.match(inlinePropertyDecorationSource, /isHealthWorkoutSetInlineLine/);
  assert.match(inlinePropertyDecorationSource, /isRenderedHealthWorkoutSetField/);
  assert.match(inlinePropertyDecorationSource, /isVisibleHealthWorkoutInlineKey/);
});

test('reserved TPS inline metadata stays hidden in every rendered Markdown host', () => {
  assert.match(inlinePropertyDecorationSource, /const isReservedMetadata = DEFAULT_INLINE_DENY_KEYS\.has\(normalizedKey\)/);
  assert.match(inlinePropertyDecorationSource, /normalizedKey\.startsWith\('tps'\) \|\| normalizedKey === 'subitemid'/);
  assert.match(inlinePropertyDecorationSource, /const isVisible =\s+!isReservedMetadata &&\s+visibleKeys\.has\(normalizedKey\)/);
  assert.match(inlinePropertyDecorationSource, /'tpsid'/);
  assert.match(inlinePropertyDecorationSource, /'subitemid'/);
  assert.match(inlinePropertyDecorationSource, /'tpsinlineprops'/);
  assert.match(inlinePropertyDecorationSource, /'tps-inline-props'/);
  assert.match(pluginStylesSource, /\.markdown-rendered \.tps-gcm-hidden-inline-property-rendered,/);
  assert.match(inlinePropertyDecorationSource, /field\.hidden = false;\s+field\.style\.removeProperty\('display'\)/);
  assert.match(inlinePropertyDecorationSource, /field\.hidden = true;\s+field\.style\.setProperty\('display', 'none', 'important'\)/);
  assert.equal((inlinePropertyDecorationSource.match(/wrapper\.hidden = true;/g) || []).length, 2);
});

test('generic rendered Markdown hosts share the normal inline-property chip presentation', () => {
  const renderedHosts = ':is(.markdown-preview-view, .markdown-reading-view, .markdown-rendered)';
  assert.equal(pluginStylesSource.includes(`${renderedHosts} .dataview.inline-field {`), true);
  assert.equal(pluginStylesSource.includes(`${renderedHosts} .dataview.inline-field-key {`), true);
  assert.equal(pluginStylesSource.includes(`${renderedHosts} .dataview.inline-field-value {`), true);
  assert.equal(pluginStylesSource.includes(`${renderedHosts} .tps-gcm-rendered-inline-property-chip.dataview.inline-field {`), true);
  assert.equal(pluginStylesSource.includes(`${renderedHosts} .tps-gcm-rendered-inline-property-chip--scheduled,`), true);
  assert.equal(pluginStylesSource.includes(`${renderedHosts} .tps-gcm-rendered-inline-property-chip--time-estimate {`), true);
});

test('AI assisted task creator uses AI Assistant proposal API and review-gated writes', () => {
  assert.match(commandsSource, /id: 'ai-assisted-task-creator'/);
  assert.match(commandsSource, /name: 'AI assisted task creator'/);
  assert.match(commandsSource, /plugin\.aiAssistedTaskService\.openAiAssistedTaskModal\(\)/);
  assert.match(mainSource, /aiAssistedTaskService: AiAssistedTaskService/);
  assert.match(mainSource, /new AiAssistedTaskService\(this\)/);
  assert.match(aiAssistedTaskServiceSource, /proposeTaskCreation/);
  assert.match(aiAssistedTaskServiceSource, /noteCandidates/);
  assert.match(aiAssistedTaskServiceSource, /allowedTargetFilePaths/);
  assert.match(aiAssistedTaskServiceSource, /originalInput/);
  assert.match(aiAssistedTaskServiceSource, /compact-task-routing-v1/);
  assert.match(aiAssistedTaskServiceSource, /taskTitleHint/);
  assert.match(aiAssistedTaskServiceSource, /routeHint/);
  assert.match(aiAssistedTaskServiceSource, /readCompactNoteContext/);
  assert.match(aiAssistedTaskServiceSource, /\.slice\(0, 6\)/);
  assert.match(aiAssistedTaskServiceSource, /baseCandidates/);
  assert.match(aiAssistedTaskServiceSource, /canvasCandidates/);
  assert.match(aiAssistedTaskServiceSource, /addToListItem/);
  assert.match(aiAssistedTaskServiceSource, /Task model kept routing words in the task title/);
  assert.match(aiAssistedTaskServiceSource, /targetFilePath must exactly match one of the noteCandidates paths|selected an invalid markdown target/);
  assert.match(aiAssistedTaskServiceSource, /vault\.process\(targetFile, \(content\) => \{/);
  assert.match(aiAssistedTaskServiceSource, /isLinkedSubitemSemanticCheckboxPlanCurrent\(/);
  assert.match(aiAssistedTaskServiceSource, /return this\.insertTaskLine\(content, taskLine, proposal\)/);
  assert.match(aiAssistedTaskServiceSource, /buildCreatedTaskLine/);
  assert.match(aiAssistedTaskServiceSource, /findAfterFrontmatterIndex/);
  assert.match(aiAssistedTaskModalSource, /Add follow-up message/);
  assert.match(aiAssistedTaskModalSource, /Accept/);
  assert.match(aiAssistedTaskModalSource, /service\.accept\(this\.proposal\)/);
  assert.doesNotMatch(aiAssistedTaskServiceSource, /status::/i);
});

test('task recurrence utilities support fixed schedules and after-completion schedules', async () => {
  const {
    calculateNextTaskScheduledValue,
    buildTaskRecurrenceTemplateLine,
    buildNextTaskRecurrenceLine,
    findTaskBlockEndIndex,
  } = await importTaskRecurrenceUtility();

  assert.equal(
    calculateNextTaskScheduledValue('GCM-AFTER-COMPLETION:P2D', {
      completedAt: new Date(2026, 5, 1, 15, 30, 0),
    }),
    '2026-06-03 15:30:00',
  );
  assert.equal(
    calculateNextTaskScheduledValue('RRULE:FREQ=DAILY', {
      scheduledValue: '2026-06-01 09:00:00',
      completedAt: new Date(2026, 5, 1, 18, 0, 0),
    }),
    '2026-06-02 09:00:00',
  );
  const completed = '- [x] water plants [workflow:: complete] [recurrence:: GCM-AFTER-COMPLETION:P1D] [completedDate:: 2026-06-01 12:00:00] [tpsId:: old-line] [subitemId:: child-note] [icon:: lucide:leaf] #home';
  const template = buildTaskRecurrenceTemplateLine(completed, '[o]', 'workflow');
  assert.equal(template, '- [o] water plants [recurrence:: GCM-AFTER-COMPLETION:P1D] #home');
  assert.equal(
    buildNextTaskRecurrenceLine(template, '2026-06-02 12:00:00', '[o]', 'workflow'),
    '- [o] water plants [recurrence:: GCM-AFTER-COMPLETION:P1D] #home [scheduled:: 2026-06-02 12:00:00]',
  );
  assert.equal(findTaskBlockEndIndex(['- [x] parent', '  - child', '', '- [ ] next'], 0), 3);
});

test('task recurrence is wired into checkbox mutation, context menus, and modal quick options', () => {
  assert.match(mainSource, /import \{ TaskRecurrenceService \} from '\.\/services\/task-recurrence-service'/);
  assert.match(mainSource, /taskRecurrenceService: TaskRecurrenceService/);
  assert.match(mainSource, /new TaskRecurrenceService\(this\)/);
  assert.match(serviceSource, /Edit recurrence template\.\.\./);
  assert.match(serviceSource, /taskRecurrenceService\.editTemplateForTaskLine/);
  assert.doesNotMatch(commandsSource, /id: 'edit-task-recurrence-templates'/);
  assert.doesNotMatch(commandsSource, /taskRecurrenceService\.openTemplatesCommand/);
  assert.match(taskRecurrenceServiceSource, /task-recurrence-templates\.json/);
  assert.match(taskRecurrenceServiceSource, /handleTaskCompletion/);
  assert.match(taskRecurrenceServiceSource, /findTaskBlockEndIndex\(lines, lineIndex\)/);
  assert.match(taskRecurrenceServiceSource, /TASK_RECURRENCE_COMPLETED_DATE_KEY/);
  assert.match(taskRecurrenceServiceSource, /buildNextTaskRecurrenceLine\([\s\S]{0,180}creationMapping\.checkboxState[\s\S]{0,180}recurrenceTaskId/);
  assert.match(taskRecurrenceServiceSource, /ensureTaskRecurrenceIdOnLine\(value, recurrenceTaskId\)/);
  assert.match(recurrenceModalSource, /GCM-AFTER-COMPLETION:P1D/);
  assert.match(recurrenceModalSource, /Next Occurrences From Completion Time/);
});

test('task right-click custom properties honor value sources and keep every configured type editable', () => {
  const configuredStart = serviceSource.indexOf('private addConfiguredPropertyMenus');
  const configuredEnd = serviceSource.indexOf('private addEntityPropertyMenu', configuredStart);
  const configured = serviceSource.slice(configuredStart, configuredEnd);
  assert.match(configured, /property\.type === 'selector' \|\| property\.type === 'kind'/);
  assert.match(configured, /property\.type === 'checkbox'[\s\S]*?this\.addCheckboxPropertyMenu/);

  const selectorStart = serviceSource.indexOf('private addSelectorPropertyMenu');
  const selectorEnd = serviceSource.indexOf('private addDatetimePropertyMenu', selectorStart);
  const selector = serviceSource.slice(selectorStart, selectorEnd);
  assert.match(selector, /addPropertyValueChoiceMenuItems/);
  assert.match(selector, /onChooseLiteral: setChoice/);
  assert.match(selector, /onChooseEntity: \(choice\) => setChoice\(choice\.wikilink\)/);
  assert.doesNotMatch(selector, /TextInputModal|Set custom value/);

  const listStart = serviceSource.indexOf('private addListPropertyMenu');
  const listEnd = serviceSource.indexOf('private addCheckboxPropertyMenu', listStart);
  const list = serviceSource.slice(listStart, listEnd);
  assert.match(list, /addPropertyValueChoiceMenuItems/);
  assert.match(list, /mergeLinkList/);
  assert.match(list, /mergeStringList/);
  assert.match(list, /removeLinkListValues/);
  assert.match(list, /removeStringListValues/);
  assert.match(list, /readInlineTags\(line\)\.reduce/);
  assert.doesNotMatch(list, /TextInputModal|Set custom value/);

  const checkboxStart = serviceSource.indexOf('private addCheckboxPropertyMenu');
  const checkboxEnd = serviceSource.indexOf('private addRecurrencePropertyMenu', checkboxStart);
  const checkbox = serviceSource.slice(checkboxStart, checkboxEnd);
  assert.match(checkbox, /\['\(none\)', null\]/);
  assert.match(checkbox, /\['Yes', 'true'\]/);
  assert.match(checkbox, /\['No', 'false'\]/);

  const filterStart = serviceSource.indexOf('private isTaskMenuProperty');
  const filterEnd = serviceSource.indexOf('private getContextTaskTitle', filterStart);
  const filter = serviceSource.slice(filterStart, filterEnd);
  assert.doesNotMatch(filter, /property\.type === 'kind'/);
});
