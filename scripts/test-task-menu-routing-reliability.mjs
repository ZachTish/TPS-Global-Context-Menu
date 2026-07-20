import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const checkboxSource = readFileSync(
  new URL('../src/handlers/task-checkbox-handler.ts', import.meta.url),
  'utf8',
);
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const logBaseSource = readFileSync(new URL('../src/views/log-base-view.ts', import.meta.url), 'utf8');
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

test('TPS Table keeps Health precedence and lets task rows reach the shared task menu', () => {
  const routing = sourceBetween(
    mainSource,
    'private handleTpsTableRowContextMenu(evt: MouseEvent): boolean',
    'private registerManualContextMenuHandler',
  );
  const taskIndex = routing.indexOf("row.dataset.tpsGcmContext === 'table-task'");
  const selectionSyncIndex = routing.indexOf('applyEntryContextSelection');
  const taskReturnIndex = routing.indexOf('return false', taskIndex);
  const genericIndex = routing.indexOf('handleExternalRowContextMenu');

  assert.ok(taskIndex >= 0, 'task routing must remain present');
  assert.ok(selectionSyncIndex > taskIndex, 'task rows must synchronize visible table selection before handoff');
  assert.ok(taskReturnIndex > selectionSyncIndex, 'task selection must synchronize before shared task routing resumes');
  assert.ok(genericIndex > taskReturnIndex, 'task rows must bypass the generic table record menu');

  const recordMenu = sourceBetween(
    logBaseSource,
    'private openEntryContextMenu(evt: MouseEvent, entry: LogLineEntry, row: HTMLElement, columns: LogTableColumn[]): void',
    'private setActiveContextRow',
  );
  const foodIndex = recordMenu.indexOf('if (isFoodLogEntry(entry))');
  const publicHandoffIndex = recordMenu.indexOf('healthUiApi.openFoodLogEntryMenu');
  const genericSelectionIndex = recordMenu.indexOf('this.applyEntryContextSelection');
  assert.ok(foodIndex >= 0, 'Health food detection must remain present');
  assert.ok(publicHandoffIndex > foodIndex, 'Health food rows must use the public Health UI handoff');
  assert.ok(genericSelectionIndex > publicHandoffIndex, 'Health food rows must return before generic table selection and editing');
  assert.match(recordMenu, /if \(!healthUiApi\) \{[\s\S]*?row was left unchanged[\s\S]*?return;/);
});
