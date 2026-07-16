import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const taskApiSource = readFileSync(new URL('../src/services/task-api-service.ts', import.meta.url), 'utf8');
const pluginApiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const createTaskSource = readFileSync(new URL('../src/services/create-task-service.ts', import.meta.url), 'utf8');
const aiTaskSource = readFileSync(new URL('../src/services/ai-assisted-task-service.ts', import.meta.url), 'utf8');
const bulkEditSource = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');

test('GCM exposes a strategic task API for external agents', () => {
  assert.match(mainSource, /import \{ TaskApiService \} from '\.\/services\/task-api-service';/);
  assert.match(mainSource, /taskApiService: TaskApiService;/);
  assert.match(mainSource, /this\.taskApiService = new TaskApiService\(this\);/);
  assert.match(pluginApiSource, /tasks: plugin\.taskApiService/);

  assert.match(taskApiSource, /readonly version = 1/);
  assert.match(taskApiSource, /async list\(filter: GcmTaskListFilter = \{\}\)/);
  assert.match(taskApiSource, /async get\(ref: GcmTaskRef\)/);
  assert.match(taskApiSource, /async create\(input: GcmTaskCreateInput\)/);
  assert.match(taskApiSource, /async update\(ref: GcmTaskRef, input: GcmTaskUpdateInput\)/);
  assert.match(taskApiSource, /setCheckbox\(ref: GcmTaskRef, checkbox: string\)/);
  assert.match(taskApiSource, /setStatus\(ref: GcmTaskRef, status: string\)/);
  assert.match(taskApiSource, /setScheduled\(ref: GcmTaskRef, scheduled: string \| null\)/);
  assert.match(taskApiSource, /setField\(ref: GcmTaskRef, key: string, value: string \| number \| boolean \| null\)/);
  assert.match(taskApiSource, /setFields\(ref: GcmTaskRef, fields: Record<string, string \| number \| boolean \| null \| undefined>\)/);
  assert.match(taskApiSource, /findByField\(key: string, value: string \| string\[\] \| null, filter: GcmTaskListFilter = \{\}\)/);
  assert.match(taskApiSource, /async move\(/);
  assert.match(taskApiSource, /async delete\(ref: GcmTaskRef\)/);
  assert.match(taskApiSource, /async focus\(ref: GcmTaskRef\)/);
});

test('task API uses task-line semantics instead of note semantics', () => {
  assert.match(taskApiSource, /type: 'task-line'/);
  assert.match(taskApiSource, /GcmTaskRef/);
  assert.match(taskApiSource, /line\?: number/);
  assert.match(taskApiSource, /lineNumber\?: number/);
  assert.match(taskApiSource, /rawLine\?: string/);
  assert.match(taskApiSource, /findCurrentTaskLineIndex/);
  assert.match(taskApiSource, /getTaskDisplayTitle/);
  assert.match(taskApiSource, /parseTaskLine/);
  assert.match(taskApiSource, /readInlineFields/);
  assert.match(taskApiSource, /blockLineCount/);
  assert.match(taskApiSource, /extractTaskBlock\(allLines, lineNumber\)/);
  assert.match(taskApiSource, /\[cleanKey\]: value/);
  assert.match(taskApiSource, /return this\.update\(ref, \{ fields: \{ \[cleanKey\]: value \} \}\)/);
  assert.match(taskApiSource, /return this\.list\(\{\s+\.\.\.filter,\s+fields: \{/);
});

test('task API mutations preserve safe task-specific behavior', () => {
  assert.match(taskApiSource, /this\.plugin\.app\.vault\.process\(targetFile/);
  assert.match(taskApiSource, /this\.plugin\.app\.vault\.process\(resolved\.file/);
  assert.match(taskApiSource, /insertLineAfterFrontmatter\(content, line\)/);
  assert.match(taskApiSource, /insertTaskBlockAfterFrontmatter\(content, block\.lines\)/);
  assert.match(taskApiSource, /removeTaskBlockFromContent\(content, sourceIndex, resolved\.record\.rawLine, resolved\.record\.title\)/);
  assert.ok(taskApiSource.includes('setTaskCheckboxToken(next, `[${marker}]`)'));
  assert.ok(taskApiSource.includes('updateTaskCompletedDateForCheckboxState(next, `[${marker}]`'));
  assert.match(taskApiSource, /setInlineFieldValueOnTaskLine\(next, 'status', null\)/);
  assert.match(taskApiSource, /statusToCheckboxMarker\(status: string\)/);
  assert.match(taskApiSource, /linkedSubitemCheckboxMappings/);
  assert.match(taskApiSource, /emitFilesUpdated/);
  assert.match(taskApiSource, /emitCalendarRefresh/);
  assert.match(taskApiSource, /refreshLivePreviewEditors: true/);
});

test('task focus and create flows use the shared focused-tab opener', () => {
  const focusSource = taskApiSource.slice(
    taskApiSource.indexOf('private async focusTask'),
    taskApiSource.indexOf('private notifyChanged'),
  );
  assert.match(focusSource, /this\.plugin\.openFileInLeaf\(file, false/);
  assert.match(focusSource, /this\.plugin\.findOpenLeafForFile\(file\)/);
  assert.doesNotMatch(focusSource, /getLeaf\(false\)\.openFile/);
  assert.doesNotMatch(focusSource, /const leaf = this\.plugin\.app\.workspace\.getLeaf\(false\)/);

  const createFocusSource = createTaskSource.slice(
    createTaskSource.indexOf('private async focusLineBeforeInsertedTask'),
    createTaskSource.indexOf('private getDailyNotesFolder'),
  );
  assert.match(createFocusSource, /this\.plugin\.openFileInLeaf\(file, false/);
  assert.match(createFocusSource, /this\.plugin\.findOpenLeafForFile\(file\)/);
  assert.doesNotMatch(createFocusSource, /getLeaf\(false\)\.openFile/);

  assert.match(aiTaskSource, /this\.plugin\.openFileInLeaf\(targetFile, false/);
  assert.doesNotMatch(aiTaskSource, /getLeaf\(false\)\.openFile\(targetFile/);
});

test('task API and bulk edit mutations emit high-level cause/result logs', () => {
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'create:start'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'create:done'/);
  assert.match(taskApiSource, /logger\.flowError\('TaskApi', 'create:failed'/);
  assert.match(taskApiSource, /logger\.flowWarn\('TaskApi', 'update:target-unresolved'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'update:start'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'update:done'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'move:start'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'move:done'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'delete:start'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'delete:done'/);
  assert.match(taskApiSource, /private summarizeRef\(ref: GcmTaskRef\): Record<string, unknown>/);

  assert.match(bulkEditSource, /logger\.flow\('BulkEdit', 'apply:start'/);
  assert.match(bulkEditSource, /logger\.flow\('BulkEdit', 'apply:done'/);
  assert.match(bulkEditSource, /logger\.flowError\('BulkEdit', 'apply:file-failed'/);
  assert.match(bulkEditSource, /logger\.flow\('BulkEdit', 'frontmatter:update-start'/);
  assert.match(bulkEditSource, /logger\.flowWarn\('BulkEdit', 'frontmatter:blocked-protected-keys'/);
  assert.match(bulkEditSource, /logger\.flow\('BulkEdit', 'frontmatter:update-canceled'/);
  assert.match(bulkEditSource, /logger\.flow\('BulkEdit', 'frontmatter:update-done'/);
});
