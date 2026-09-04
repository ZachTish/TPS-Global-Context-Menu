import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('scheduled modal converts datetime-local values to space-separated frontmatter values', () => {
  const source = read('src/modals/scheduled-modal.ts');
  assert.match(source, /dateValue = dateValue\.replace\('T', ' '\)/);
  assert.doesNotMatch(source, /dateValue \+= 'T00:00:00'/);
});

test('recurrence writes scheduled values with space separator', () => {
  const source = read('src/services/bulk-edit-service.ts');

  assert.match(source, /const scheduled = window\.moment\(firstOccurrence\)\.format\('YYYY-MM-DD HH:mm:ss'\)/);
  assert.match(source, /const newScheduled = window\.moment\(nextDate\)\.format\('YYYY-MM-DD HH:mm:ss'\)/);
  assert.doesNotMatch(source, /const scheduled = window\.moment\(firstOccurrence\)\.format\('YYYY-MM-DDTHH:mm:ss'\)/);
  assert.doesNotMatch(source, /const newScheduled = window\.moment\(nextDate\)\.format\('YYYY-MM-DDTHH:mm:ss'\)/);
});

test('shared date normalization formats only complete local values and preserves zoned instants', async () => {
  const source = read('src/utils/obsidian-date-time.ts');
  assert.match(source, /return `\$\{dateOnly\[1\]\} 00:00:00`/);
  assert.match(source, /return parsed\.format\('YYYY-MM-DD HH:mm:ss'\)/);
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/obsidian-date-time.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  });
  const { normalizeObsidianDateTimeValue: normalize } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  for (const value of [
    '2026-09-03T16:00:00.000Z', '2026-09-03T16:30:00Z',
    '2026-09-03T11:00:00-05:00', '2026-09-03T21:30:00.123456+05:30',
    '2026-11-01T01:30:00-05:00', '2026-11-01T01:30:00-06:00',
    '2026-09-03T16:00Z', '2026-09-03T11:00:00-0500',
    '2026-09-03T16:00:00 trailing text', '{{date}}', '<% tp.date.now() %>',
  ]) assert.equal(normalize(value), value);
  assert.equal(normalize('2026-09-03T11:00'), '2026-09-03 11:00:00');
  assert.equal(normalize('2026-09-03 9:02:03.456'), '2026-09-03 09:02:03.456');
  assert.equal(normalize('2026-09-03'), '2026-09-03 00:00:00');
  assert.equal(normalize(new Date('2026-09-03T16:00:00Z')), '2026-09-03T16:00:00.000Z');
  assert.equal(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(normalize('2026-09-03T16:00:00.000Z'))), '11:00 AM');
  for (const path of ['frontmatter-mutation-service', 'bulk-edit-service', 'subitem-creation-service']) {
    assert.match(read(`src/services/${path}.ts`), /import \{ normalizeObsidianDateTimeValue \} from '\.\.\/utils\/obsidian-date-time'/);
  }
  assert.doesNotMatch(read('src/utils/completed-date-utils.ts'), /toISOString\(\)\.slice\(0, 19\)/);
  assert.doesNotMatch(read('src/services/frontmatter-mutation-service.ts'), /toISOString\(\)\.slice\(0, 19\)/);
  assert.doesNotMatch(read('src/events/register-events.ts'), /toISOString\(\).*slice\(0, 19\)/);
});

test('daily-note scheduled writers use midnight timestamp, not bare date or T separator', () => {
  const noteOperation = read('src/services/note-operation-service.ts');
  const dailyNav = read('src/handlers/daily-note-nav-manager.ts');
  const fileNaming = read('src/services/file-naming-service.ts');
  const dailyNoteSchedule = read('src/utils/daily-note-task-schedule.ts');

  assert.match(dailyNoteSchedule, /return `\$\{String\(isoDate \|\| ''\)\.trim\(\)\} 00:00:00`/);
  assert.match(noteOperation, /const scheduledValue = isoDate \? getDailyNoteScheduledValueForIsoDate\(isoDate\) : `\$\{titleValue\} 00:00:00`/);
  assert.match(noteOperation, /fm\.scheduled = scheduledValue/);
  assert.match(dailyNav, /noteOperationService\.ensureDailyNote\(`\$\{isoDate\} 00:00:00`\)/);
  assert.doesNotMatch(dailyNav, /fm\.scheduled\s*=/);
  assert.match(fileNaming, /const expectedScheduled = `\$\{expectedDate\} 00:00:00`/);
  assert.doesNotMatch(fileNaming, /frontmatter\.scheduled = expectedIso/);
});

test('shared schedule parsing preserves full instants, DST offsets, and precision without Moment', async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/shared/schedule-service.ts', import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
  });
  const { SharedScheduleService } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const previousTimezone = process.env.TZ;
  const previousWindow = globalThis.window;
  process.env.TZ = 'America/Chicago';
  delete globalThis.window;
  try {
    const service = new SharedScheduleService();
    for (const input of ['2026-09-03T16:00:42.123Z', '2026-09-03T11:00:42.123-05:00', '2026-09-03T11:00:42.123-0500', '2026-09-03T21:30:42.123456+05:30']) {
      assert.equal(service.parseDate(input)?.toISOString(), '2026-09-03T16:00:42.123Z');
      assert.equal(service.parseDate(input)?.getHours(), 11);
      assert.deepEqual(service.parseTimeRange(input), { start: Date.parse(input), end: null }, 'a negative timezone offset is not an end-time range');
      assert.equal(service.parseDateMillis(`[[${input}]]`), Date.parse(input));
      assert.deepEqual(service.parseTimeRange(`[[${input}]]`), { start: Date.parse(input), end: null });
    }
    const source = new Date('2026-09-03T16:00:42.123Z');
    assert.equal(service.parseDateMillis(source), source.getTime());
    assert.equal(service.parseDateMillis([source]), source.getTime());
    assert.deepEqual(service.parseTimeRange(source), { start: source.getTime(), end: null });
    assert.equal(service.parseDateMillis(new Date(Number.NaN)), null);
    assert.equal(service.parseDate('2026-09-03 11:00:42.123')?.toISOString(), source.toISOString());
    assert.equal(service.parseDate('2026-09-03')?.getDate(), 3);
    assert.equal(service.parseDate('2026-09-03')?.getHours(), 0);
    const firstFold = service.parseDateMillis('2026-11-01T01:30:00-05:00');
    const secondFold = service.parseDateMillis('2026-11-01T01:30:00-06:00');
    assert.equal(secondFold - firstFold, 3_600_000, 'fall-back fold instants remain distinct');
    for (const invalid of ['2026-02-30T11:00:00Z', '2026-09-03T25:00:00Z', '2026-09-03T11:00:00+25:00']) {
      assert.equal(service.parseDateMillis(invalid), null, 'invalid complete values never fall back to a valid-looking prefix');
    }
    const range = service.parseTimeRange('2026-09-03T11:00:42.123-05:00 – 2026-09-03T11:30:42.123-05:00');
    assert.deepEqual(range, { start: source.getTime(), end: source.getTime() + 1_800_000 });

    const legacyCalls = [];
    globalThis.window = { moment(raw) {
      legacyCalls.push(raw);
      const date = new Date(String(raw).replace(' ', 'T'));
      return { isValid: () => Number.isFinite(date.getTime()), valueOf: () => date.getTime() };
    } };
    assert.equal(service.parseDate('Meeting 2026-09-03 09:15 confirmed')?.getHours(), 9);
    assert.deepEqual(legacyCalls, ['2026-09-03 09:15'], 'legacy free-text extraction still reaches the configured parser');
    assert.equal(service.parseDate('2026-09-03 09:15 - 2026-09-03 10:00')?.getHours(), 9);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
