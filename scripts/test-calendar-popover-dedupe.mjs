import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');

test('calendar popover dedupes mirrored task, note, and external calendar items', () => {
  assert.match(source, /private dedupeCalendarPopoverItems\(items: CalendarPopoverItem\[\]\): CalendarPopoverItem\[\]/);
  assert.match(source, /item\.externalKey \? `external:\$\{item\.externalKey\}`/);
  assert.match(source, /item\.uidDayKey \? `uid-day:\$\{item\.uidDayKey\}`/);
  assert.match(source, /item\.kind !== 'external' && item\.localSlotKey \? `local-slot:\$\{item\.localSlotKey\}`/);
  assert.match(source, /if \(item\.kind === 'task'\) return 30;/);
  assert.match(source, /if \(item\.kind === 'note'\) return 20;/);
  assert.match(source, /return this\.dedupeCalendarPopoverItems\(items\)/);
});

test('calendar popover title matching ignores task metadata and tags', () => {
  assert.match(source, /\.replace\(\s*\/%%\[\\s\\S\]\*\?%%\/g,\s*' '\s*\)/);
  assert.match(source, /\.replace\(\s*\/\\\[\[A-Za-z0-9_-\]\+\\s\*::\[\^\\\]\]\*]\/g,\s*' '\s*\)/);
  assert.match(source, /\.replace\(\s*\/#\[\\p\{L\}\\p\{N\}_\/-\]\+\/gu,\s*' '\s*\)/);
  assert.match(source, /buildCalendarPopoverLocalSlotKey\(task\.title, task\.date\)/);
  assert.match(source, /buildCalendarPopoverLocalSlotKey\(displayTitle, localDate\)/);
});
