import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const serviceSource = await readFile(
  fileURLToPath(new URL('../src/services/auto-pin-active-note-service.ts', import.meta.url)),
  'utf8',
);
const timeTrackingSource = await readFile(
  fileURLToPath(new URL('../src/services/time-tracking-service.ts', import.meta.url)),
  'utf8',
);

test('auto-pin treats active time-tracked targets as active notes', () => {
  assert.match(serviceSource, /\| \{ kind: 'time-tracking'; count: number \}/);
  assert.match(serviceSource, /this\.plugin\.timeTrackingService\?\.isEnabled\?\.\(\) === true/);
  assert.match(serviceSource, /const activeTimerPaths = await this\.getActiveTimerPathSet\(\)/);
  assert.match(serviceSource, /activeTimerPaths\.has\(file\.path\)/);
  assert.match(serviceSource, /return \{ kind: 'time-tracking', count: activeTimerCount \}/);
  assert.match(serviceSource, /if \(timer\.targetType !== 'note'\) continue/);
  assert.match(serviceSource, /String\(timer\.targetPath \|\| timer\.sourcePath \|\| ''\)\.trim\(\)/);
});

test('auto-pin does not treat task timers as note-level pinned-note activity', () => {
  assert.match(timeTrackingSource, /if \(session\.record\.targetType !== 'note'\) continue/);
  assert.doesNotMatch(
    timeTrackingSource,
    /const paths = new Set<string>\(\);[\s\S]*?sourcePath[\s\S]*?target\?\.file\.path[\s\S]*?activeTimerCountsByPath = next/,
  );
});

test('auto-pin announces why it reopened a managed pinned note', () => {
  assert.match(serviceSource, /new Notice\(`Reopened pinned note "\$\{file\.basename\}" because \$\{this\.describeReason\(reason\)\}\.`\)/);
  assert.match(serviceSource, /private describeReason\(reason: MatchReason \| undefined\): string/);
  assert.match(serviceSource, /it has an active note-level time tracking session/);
  assert.match(serviceSource, /its note-level scheduled time is active/);
});

test('time tracking refreshes auto-pin state when running timers change', () => {
  assert.match(timeTrackingSource, /private async refreshAutoPinActiveNotes\(activeSessions\?: StoredSession\[\]\): Promise<void>/);
  assert.match(timeTrackingSource, /await this\.refreshAutoPinActiveNotes\(\)/);
  assert.match(timeTrackingSource, /await this\.plugin\.autoPinActiveNoteService\?\.evaluateAllFiles\(\)/);
});

test('auto-pin opens through the normal GCM file-open path before pinning', () => {
  assert.match(serviceSource, /this\.plugin\.openFileInLeaf\(file, false, \(\) => leaf, \{/);
  assert.match(serviceSource, /active: false/);
  assert.match(serviceSource, /revealLeaf: true/);
  assert.match(serviceSource, /leaf\.setPinned\(true\)/);
});
