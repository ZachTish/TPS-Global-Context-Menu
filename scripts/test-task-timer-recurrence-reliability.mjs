import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const timeTrackingSource = readFileSync(
  new URL('../src/services/time-tracking-service.ts', import.meta.url),
  'utf8',
);
const recurrenceServiceSource = readFileSync(
  new URL('../src/services/task-recurrence-service.ts', import.meta.url),
  'utf8',
);

async function importTaskRecurrenceUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/task-recurrence.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

test('task timers re-resolve the current task before reading or attaching a stable id', () => {
  assert.match(timeTrackingSource, /export interface TimeTrackingTargetInput[\s\S]*?rawLine\?: string;/);
  assert.match(timeTrackingSource, /findCurrentTaskLineIndex\([\s\S]{0,240}preferredLineNumber[\s\S]{0,240}sourceRawLine[\s\S]{0,240}sourceTitle/);
  assert.match(
    timeTrackingSource,
    /private async ensureTaskLineTpsId\([\s\S]{0,1800}vault\.process\([\s\S]{0,900}findCurrentTaskLineIndex\(lines, preferredLineNumber, rawLine, title\)/,
  );
  assert.match(timeTrackingSource, /lineNumber: ensured\.lineNumber/);
  assert.match(timeTrackingSource, /rawLine: target\.rawLine/);
  assert.match(timeTrackingSource, /Task target became stale before stable-id write/);
});

test('recurrence template editing resolves its source atomically and refuses stale targets', () => {
  assert.match(
    recurrenceServiceSource,
    /editTemplateForTaskLine[\s\S]{0,2200}mutateMarkdownBody\(file[\s\S]{0,900}findCurrentTaskLineIndex/,
  );
  assert.match(recurrenceServiceSource, /Template target was stale or ambiguous/);
  assert.match(recurrenceServiceSource, /Could not uniquely find the recurrence template task/);
  assert.doesNotMatch(recurrenceServiceSource, /writeLineByIndex/);
});

test('recurrence clones keep recurrence identity while dropping instance and hidden TPS identity', async () => {
  const {
    buildNextTaskRecurrenceLine,
    buildTaskRecurrenceTemplateLine,
  } = await importTaskRecurrenceUtility();
  const source = '- [x] Recurring task [recurrence:: FREQ=DAILY] [recurrenceTaskId:: rec-1] [tpsId:: task-1] [subitemId:: sub-1] [completedDate:: 2026-07-14 09:00:00] %% tps-inline-props:{"associatedNotePath":"Tasks/Recurring task.md","externalId":"reminder-1","stableId":"stable-1"} %%';

  const template = buildTaskRecurrenceTemplateLine(source);
  assert.match(template, /^- \[ \] Recurring task/);
  assert.match(template, /\[recurrence:: FREQ=DAILY\]/);
  assert.match(template, /\[recurrenceTaskId:: rec-1\]/);
  assert.doesNotMatch(template, /tpsId|subitemId|completedDate|tps-inline-props|associatedNotePath|externalId|stableId/i);

  const next = buildNextTaskRecurrenceLine(template, '2026-07-15 09:00:00');
  assert.match(next, /\[recurrenceTaskId:: rec-1\]/);
  assert.match(next, /\[scheduled:: 2026-07-15 09:00:00\]/);
  assert.doesNotMatch(next, /tpsId|subitemId|completedDate|tps-inline-props|associatedNotePath|externalId|stableId/i);
});
