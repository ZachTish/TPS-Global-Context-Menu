import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const menuSource = readFileSync(
  new URL('../src/services/task-line-context-menu-service.ts', import.meta.url),
  'utf8',
);
const dailyLineSource = readFileSync(
  new URL('../src/services/daily-inbox-line-service.ts', import.meta.url),
  'utf8',
);
const scheduledModalSource = readFileSync(
  new URL('../src/modals/scheduled-modal.ts', import.meta.url),
  'utf8',
);
const recurrenceModalSource = readFileSync(
  new URL('../src/modals/recurrence-modal.ts', import.meta.url),
  'utf8',
);
const textModalSource = readFileSync(
  new URL('../src/modals/text-input-modal.ts', import.meta.url),
  'utf8',
);
const fileModalSource = readFileSync(
  new URL('../src/modals/FileSuggestModal.ts', import.meta.url),
  'utf8',
);
const taskApiSource = readFileSync(
  new URL('../src/services/task-api-service.ts', import.meta.url),
  'utf8',
);
const lineDeleteSource = readFileSync(
  new URL('../src/services/line-item-delete-service.ts', import.meta.url),
  'utf8',
);
const nestedDeleteModalSource = readFileSync(
  new URL('../src/modals/nested-line-delete-modal.ts', import.meta.url),
  'utf8',
);
const lineDeleteMutationSource = readFileSync(
  new URL('../src/utils/line-item-deletion.ts', import.meta.url),
  'utf8',
);

test('task menu titles are plain and note actions describe whether they create or open', () => {
  assert.match(menuSource, /context\.title = this\.getContextTaskTitle\(context\)/);
  assert.match(menuSource, /getTaskDisplayTitle\(context\.rawLine\) \|\| getPlainTaskTitle\(context\.title\)/);
  assert.match(menuSource, /parseTaskTitleLink\(getTaskSourceTitle\(context\.rawLine\)\)/);
  assert.match(menuSource, /hasAssociatedNote \? 'Open linked note' : 'Create note for task'/);
  assert.match(menuSource, /return matches\.length === 1 \? matches\[0\] : -1/);
});

test('task property rows honor the master switch, context visibility, and date-specific UI', () => {
  assert.match(menuSource, /showCustomPropertiesInContextMenu === false\) return/);
  assert.match(menuSource, /resolveCustomProperties\([\s\S]{0,500}'context'/);
  assert.match(menuSource, /showTimeDetails: false/);
  assert.match(scheduledModalSource, /if \(this\.options\.showTimeDetails\)/);
  assert.match(scheduledModalSource, /fieldLabel: String\(options\.fieldLabel/);
});

test('TPS List and TPS Table task menus expose Tags independently of custom properties', () => {
  assert.match(menuSource, /const surface = taskElSurface\(taskEl\)/);
  assert.match(menuSource, /includeTags: surface === 'tps-list' \|\| surface === 'tps-table'/);
  assert.match(menuSource, /if \(options\.includeTags === true\) \{\s*this\.addInlineTagsMenu\(menu, context\)/);
  assert.match(menuSource, /setTitle\(current\.length > 0 \? `Tags \(\$\{current\.length\}\)` : 'Tags'\)/);
  assert.match(menuSource, /setTitle\('Add tag\.\.\.'\)/);
  assert.match(menuSource, /addInlineTagToTaskLine\(line, tag\)/);
  assert.match(menuSource, /removeInlineTagFromTaskLine\(line, tag\)/);
  assert.match(menuSource, /addConfiguredPropertyMenus\(menu, context, options\.includeTags === true\)/);
  assert.match(menuSource, /excludeTags[\s\S]{0,180}property\.listItemType === 'tag'/);
});

test('task action modals await writes and report rejected callbacks', () => {
  for (const source of [scheduledModalSource, recurrenceModalSource, textModalSource, fileModalSource]) {
    assert.match(source, /await this\.onSubmit|Promise\.resolve\(this\.onChoose/);
    assert.match(source, /catch \(error\)|\.catch\(\(error\)/);
    assert.match(source, /flowError/);
  }
  assert.match(menuSource, /if \(property\.type === 'number' && raw && !Number\.isFinite\(Number\(raw\)\)\)/);
  assert.match(menuSource, /const updated = await this\.updateTaskLine\([\s\S]{0,500}if \(!updated\) return/);
});

test('task note creation preserves legacy associations and refuses ambiguous matching children', () => {
  assert.match(dailyLineSource, /const rawTitle = this\.getLineSourceTitle\(context\.rawLine\)/);
  assert.match(dailyLineSource, /getTaskSourceTitle\(line\)/);
  assert.match(dailyLineSource, /matchingChild\.matchCount > 1/);
  assert.match(dailyLineSource, /Use “Link task to note…” to choose one/);
});

test('move, delete, and API writes expose stale or partial failures instead of reporting success', () => {
  assert.match(menuSource, /rollbackInsertedTaskBlock/);
  assert.match(menuSource, /targetRolledBack: rolledBack/);
  assert.match(menuSource, /private async deleteSingleTask/);
  assert.match(menuSource, /requestLineItemDelete\(this\.createTaskDeleteTarget\(context, 'task-menu-single'\)\)/);
  assert.match(menuSource, /promptNestedLineDelete\(this\.plugin\.app/);
  assert.match(menuSource, /performLineItemDelete\(target, mode/);
  assert.match(lineDeleteSource, /refuseUnexpectedNestedContent/);
  assert.match(lineDeleteSource, /mutation:nested-content-appeared/);
  assert.match(lineDeleteSource, /mode === 'promote-children'/);
  assert.match(lineDeleteSource, /target\.blockKind === 'heading-section'/);
  assert.match(lineDeleteMutationSource, /extractHeadingSectionBlock/);
  assert.match(lineDeleteMutationSource, /candidateLevel && candidateLevel <= headingLevel/);
  assert.match(nestedDeleteModalSource, /Move nested content up/);
  assert.match(nestedDeleteModalSource, /preserveNestedContentLabel/);
  assert.match(nestedDeleteModalSource, /Delete item and nested content/);
  assert.match(taskApiSource, /update:stale-target/);
  assert.match(taskApiSource, /delete:stale-target/);
  assert.match(taskApiSource, /Task line changed before it could be updated/);
  assert.match(taskApiSource, /Task line changed before it could be deleted/);
});
