import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('scheduled modal converts datetime-local values to space-separated frontmatter values', () => {
  const source = read('src/modals/scheduled-modal.ts');
  assert.match(source, /dateValue = dateValue\.replace\('T', ' '\)/);
  assert.doesNotMatch(source, /dateValue \+= 'T00:00:00'/);
});

test('recurrence writes scheduled values with space separator', () => {
  const source = read('src/services/bulk-edit-service.ts');

  assert.match(source, /const scheduled = window\.moment\(firstOccurrence\)\.format\('YYYY-MM-DD HH:mm:ss'\)/);
  assert.match(source, /const newScheduled = nextDate \? window\.moment\(nextDate\)\.format\('YYYY-MM-DD HH:mm:ss'\)/);
  assert.doesNotMatch(source, /const scheduled = window\.moment\(firstOccurrence\)\.format\('YYYY-MM-DDTHH:mm:ss'\)/);
  assert.doesNotMatch(source, /const newScheduled = nextDate \? window\.moment\(nextDate\)\.format\('YYYY-MM-DDTHH:mm:ss'\)/);
});

test('generic frontmatter date normalization emits space-separated datetime strings', () => {
  const source = read('src/services/frontmatter-mutation-service.ts');
  assert.match(source, /return `\$\{dateOnly\[1\]\} 00:00:00`/);
  assert.match(source, /return parsed\.format\('YYYY-MM-DD HH:mm:ss'\)/);
  assert.doesNotMatch(source, /return parsed\.format\('YYYY-MM-DDTHH:mm:ss'\)/);
});

test('daily-note scheduled writers use midnight timestamp, not bare date or T separator', () => {
  const noteOperation = read('src/services/note-operation-service.ts');
  const dailyNav = read('src/handlers/daily-note-nav-manager.ts');
  const fileNaming = read('src/services/file-naming-service.ts');
  const dailyNoteSchedule = read('src/utils/daily-note-task-schedule.ts');

  assert.match(dailyNoteSchedule, /return `\$\{String\(isoDate \|\| ''\)\.trim\(\)\} 00:00:00`/);
  assert.match(noteOperation, /const scheduledValue = isoDate \? getDailyNoteScheduledValueForIsoDate\(isoDate\) : `\$\{titleValue\} 00:00:00`/);
  assert.match(noteOperation, /fm\.scheduled = scheduledValue/);
  assert.match(dailyNav, /const scheduledValue = isoDate \? getDailyNoteScheduledValueForIsoDate\(isoDate\) : `\$\{titleValue\} 00:00:00`/);
  assert.match(dailyNav, /fm\.scheduled = scheduledValue/);
  assert.match(fileNaming, /const expectedScheduled = `\$\{expectedDate\} 00:00:00`/);
  assert.doesNotMatch(fileNaming, /frontmatter\.scheduled = expectedIso/);
});
