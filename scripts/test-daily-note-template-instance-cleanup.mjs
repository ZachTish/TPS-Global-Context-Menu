import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

test('post-create Daily Note repair service and all event registrations are retired', () => {
  assert.equal(existsSync(new URL('../src/services/daily-note-template-instance-cleanup-service.ts', import.meta.url)), false);
  const events = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(events, /DailyNoteTemplateInstanceCleanup|dailyNoteTemplateInstanceCleanup|scheduleCreatedFileAutomation/);
});
