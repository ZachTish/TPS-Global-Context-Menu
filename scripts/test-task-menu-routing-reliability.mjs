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

test('last-checklist-item status prompt requires an existing nonblank note status', () => {
  const promptFlow = sourceBetween(
    checkboxSource,
    'private async maybePromptToCompleteNote(',
    'private hasOpenChecklistItems(',
  );
  const statusReadIndex = promptFlow.indexOf("const status = String(cache?.frontmatter?.status ?? '').trim().toLowerCase();");
  const statusGuardIndex = promptFlow.indexOf("if (!status || status === 'complete' || status === 'wont-do') return;");
  const promptIndex = promptFlow.indexOf('promptForFinalChecklistStatus(statusChoices)');

  assert.ok(statusReadIndex >= 0, 'the prompt must read only the note-level frontmatter status');
  assert.ok(statusGuardIndex > statusReadIndex, 'missing, null, empty, and whitespace-only status values must stop the prompt');
  assert.ok(promptIndex > statusGuardIndex, 'the status-presence guard must run before opening the modal');
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
