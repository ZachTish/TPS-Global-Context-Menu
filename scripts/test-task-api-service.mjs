import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const taskApiSource = readFileSync(new URL('../src/services/task-api-service.ts', import.meta.url), 'utf8');
const pluginApiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

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
