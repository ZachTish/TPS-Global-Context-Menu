import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTimeTrackingRecordList,
  resolveTimeTrackingStorageKind,
  timeTrackingSessionOverlapsRange,
} from '../src/services/time-tracking-format.ts';

const baseRecord = {
  id: 'tt_one',
  targetId: 'line_one',
  targetType: 'task',
  sourcePath: 'Projects/A] tricky.md',
  lineNumber: 7,
  start: '2026-05-06 09:00:00',
  end: '2026-05-06 09:30:00',
  durationMinutes: 30,
  createdAt: '2026-05-06 09:00:00',
  updatedAt: '2026-05-06 09:30:00',
};

test('normalizes frontmatter record arrays and JSON strings', () => {
  const records = normalizeTimeTrackingRecordList([
    baseRecord,
    JSON.stringify({ ...baseRecord, id: 'tt_two', targetType: 'heading' }),
    { id: '', targetId: 'missing', start: '2026-05-06 10:00:00' },
  ]);

  assert.equal(records.length, 2);
  assert.equal(records[0].id, 'tt_one');
  assert.equal(records[1].targetType, 'heading');
});

test('routes every time tracking storage mode to frontmatter storage', () => {
  assert.equal(resolveTimeTrackingStorageKind('source-note', 'task'), 'frontmatter');
  assert.equal(resolveTimeTrackingStorageKind('source-note', 'heading'), 'frontmatter');
  assert.equal(resolveTimeTrackingStorageKind('source-note', 'note'), 'frontmatter');
  assert.equal(resolveTimeTrackingStorageKind('daily-note', 'task'), 'frontmatter');
  assert.equal(resolveTimeTrackingStorageKind('dedicated-note', 'line'), 'frontmatter');
});

test('treats active sessions as running through the provided active end time for range overlap checks', () => {
  const activeRecord = {
    ...baseRecord,
    id: 'tt_active',
    start: '2026-05-06T09:00:00',
    end: undefined,
    durationMinutes: undefined,
  };
  const parseDate = (value) => {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  };

  assert.equal(
    timeTrackingSessionOverlapsRange(
      activeRecord,
      new Date('2026-05-06T09:20:00').getTime(),
      new Date('2026-05-06T09:40:00').getTime(),
      new Date('2026-05-06T09:35:00').getTime(),
      parseDate,
    ),
    true,
  );
  assert.equal(
    timeTrackingSessionOverlapsRange(
      activeRecord,
      new Date('2026-05-06T09:40:01').getTime(),
      new Date('2026-05-06T10:00:00').getTime(),
      new Date('2026-05-06T09:35:00').getTime(),
      parseDate,
    ),
    false,
  );
});
