import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const checkboxSource = readFileSync(
  new URL('../src/handlers/task-checkbox-handler.ts', import.meta.url),
  'utf8',
);
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const dragSource = readFileSync(
  new URL('../src/services/task-line-drag-service.ts', import.meta.url),
  'utf8',
);

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('checkbox menus use normalized configured mappings and retain shared task actions', () => {
  assert.doesNotMatch(checkboxSource, /TASK_STATE_OPTIONS/);
  assert.match(checkboxSource, /normalizeLinkedSubitemMappings/);
  assert.match(checkboxSource, /for \(const mapping of this\.getCheckboxMappings\(\)\)/);
  assert.match(checkboxSource, /enforceStrictDefaults:\s*false/);
  assert.match(checkboxSource, /setTitle\('Custom checkbox value\.\.\.'\)/);
  assert.match(
    checkboxSource,
    /taskLineContextMenuService\.addTaskLineMenuItems\(menu, taskLineContext,[\s\S]*includeStatus:\s*false/,
  );
});

test('checkbox writes share task-line resolution and refuse ambiguous text fallbacks', () => {
  assert.match(checkboxSource, /import \{ findCurrentTaskLineIndex \} from '\.\.\/utils\/task-block-move'/);
  assert.match(checkboxSource, /const exactMatches = lines\.reduce<number\[]>/);
  assert.match(checkboxSource, /if \(exactMatches\.length > 1\) return -1/);
  assert.match(checkboxSource, /const titleMatches = lines\.reduce<number\[]>/);
  assert.match(checkboxSource, /if \(titleMatches\.length !== 1\) return -1/);
  assert.match(checkboxSource, /findCurrentTaskLineIndex\(lines, context\.lineNumber, context\.rawLine, title\)/);
  assert.match(checkboxSource, /flowWarn\('TaskCheckboxMenu', 'write:unresolved-task'/);
});

test('rendered checkbox and drag fallbacks require exactly one text match', () => {
  for (const source of [checkboxSource, dragSource]) {
    assert.match(source, /renderedLine == null \|\| renderedLine\.trim\(\) === '' \? Number\.NaN/);
    assert.match(source, /const matches: Task(?:Checkbox|LineDrag)Context\[] = \[]/);
    assert.match(source, /return matches\.length === 1 \? matches\[0\] : null/);
  }
});

test('last-checklist-item status prompt reads only the configured workflow status', () => {
  const promptFlow = sourceBetween(
    checkboxSource,
    'private async maybePromptToCompleteNote(',
    'private hasOpenChecklistItems(',
  );
  const serviceIndex = promptFlow.indexOf('const statusService = this.plugin.sharedServices.status;');
  const keyIndex = promptFlow.indexOf('const workflowStatusKey = statusService.getStatusPropertyKey();');
  const statusReadIndex = promptFlow.indexOf('statusService.getStatuses(cache?.frontmatter, workflowStatusKey)[0]');
  const statusGuardIndex = promptFlow.indexOf('if (!status || statusService.isDoneStatus(status)) return;');
  const promptIndex = promptFlow.indexOf('promptForFinalChecklistStatus(statusChoices)');

  assert.ok(serviceIndex >= 0, 'the prompt must use the shared status service');
  assert.ok(keyIndex > serviceIndex, 'the prompt must resolve the configured workflow-status key');
  assert.ok(statusReadIndex > keyIndex, 'the prompt must read the configured workflow-status value');
  assert.ok(statusGuardIndex > statusReadIndex, 'missing, null, empty, and whitespace-only status values must stop the prompt');
  assert.ok(promptIndex > statusGuardIndex, 'the status-presence guard must run before opening the modal');
  assert.doesNotMatch(promptFlow, /frontmatter\?\.status|frontmatter\.status/u);
});

test('checklist follow-up uses mapped open/terminal states and preserves canonical ordering', () => {
  assert.match(checkboxSource, /classifyMappedTaskCheckboxState/);
  assert.match(checkboxSource, /hasOpenMappedTaskLines/);

  const followupFlow = sourceBetween(
    checkboxSource,
    'async handleExternalChecklistStateMutation(',
    'private async maybePromptToCompleteNote(',
  );
  const recurrenceIndex = followupFlow.indexOf('handleTaskCompletion');
  const promptIndex = followupFlow.indexOf('maybePromptToCompleteNote');
  const propertyIndex = followupFlow.indexOf('scheduleChecklistPropertyUpdate');
  assert.ok(recurrenceIndex >= 0, 'recurrence must run for the completed task first');
  assert.ok(promptIndex > recurrenceIndex, 'the final-note prompt must run after recurrence');
  assert.ok(propertyIndex > promptIndex, 'checklist-property sync must be scheduled after the prompt');

  const promptFlow = sourceBetween(
    checkboxSource,
    'private async maybePromptToCompleteNote(',
    'private hasOpenChecklistItems(',
  );
  assert.match(promptFlow, /if \(!previous\.isOpen \|\| !next\.isComplete\) return/);
  assert.match(
    checkboxSource,
    /private hasOpenChecklistItems\(lines: string\[\]\): boolean \{\s*return hasOpenMappedTaskLines\(lines, this\.getCheckboxMappings\(\)\);/u,
  );
  assert.match(
    checkboxSource,
    /const hasOpenChecklistItem = this\.hasOpenChecklistItems\(content\.split\(\/\\r\?\\n\/u\)\);/u,
    'the persisted checklist property must use the same configured mapping classifier',
  );
});

test('TPS Table keeps Health precedence and lets task rows reach the shared task menu', () => {
  const routing = sourceBetween(
    mainSource,
    'private handleTpsTableRowContextMenu(evt: MouseEvent): boolean',
    'private handleTpsHealthFoodTableRowContextMenu',
  );
  const healthIndex = routing.indexOf('handleTpsHealthFoodTableRowContextMenu');
  const taskIndex = routing.indexOf("row.dataset.tpsGcmContext === 'table-task'");
  const selectionSyncIndex = routing.indexOf('applyEntryContextSelection');
  const taskReturnIndex = routing.indexOf('return false', taskIndex);
  const genericIndex = routing.indexOf('handleExternalRowContextMenu');

  assert.ok(healthIndex >= 0, 'Health handoff must remain present');
  assert.ok(taskIndex > healthIndex, 'Health rows must be handed off before task routing');
  assert.ok(selectionSyncIndex > taskIndex, 'task rows must synchronize visible table selection before handoff');
  assert.ok(taskReturnIndex > selectionSyncIndex, 'task selection must synchronize before shared task routing resumes');
  assert.ok(genericIndex > taskReturnIndex, 'task rows must bypass the generic table record menu');
});
