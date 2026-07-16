import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const mainSource = await readFile(
  fileURLToPath(new URL('../src/main.ts', import.meta.url)),
  'utf8',
);
const commandsSource = await readFile(
  fileURLToPath(new URL('../src/commands/register-commands.ts', import.meta.url)),
  'utf8',
);
const constantsSource = await readFile(
  fileURLToPath(new URL('../src/constants.ts', import.meta.url)),
  'utf8',
);
const pluginApiSource = await readFile(
  fileURLToPath(new URL('../src/plugin-api.ts', import.meta.url)),
  'utf8',
);
const timeTrackingServiceSource = await readFile(
  fileURLToPath(new URL('../src/services/time-tracking-service.ts', import.meta.url)),
  'utf8',
);
const timeTrackingStatusBarSource = await readFile(
  fileURLToPath(new URL('../src/services/time-tracking-status-bar-service.ts', import.meta.url)),
  'utf8',
);
const settingsSource = await readFile(
  fileURLToPath(new URL('../src/settings-tab.ts', import.meta.url)),
  'utf8',
);
const typesSource = await readFile(
  fileURLToPath(new URL('../src/types.ts', import.meta.url)),
  'utf8',
);

test('opener diagnostics stay out of the common command palette', () => {
  assert.doesNotMatch(commandsSource, /opener.*diagnostic/i);
  assert.doesNotMatch(commandsSource, /Log opener decisions/);
  assert.doesNotMatch(commandsSource, /getOpenerDecision/);
});

test('opener decision logging is explicit and disabled by default', () => {
  assert.match(typesSource, /logOpenerDecisions: boolean/);
  assert.match(constantsSource, /logOpenerDecisions: false/);
  assert.match(settingsSource, /setName\('Log opener decisions'\)/);
  assert.match(settingsSource, /When console logging is enabled, log compact tab-routing decisions/);
  assert.match(settingsSource, /this\.plugin\.settings\.logOpenerDecisions === true/);
  assert.match(settingsSource, /this\.plugin\.settings\.logOpenerDecisions = value/);

  const logHelperSource = mainSource.slice(
    mainSource.indexOf('private logOpenerDecision'),
    mainSource.indexOf('matchesAutoFrontmatterExclusionPattern'),
  );
  assert.match(logHelperSource, /this\.settings\.logOpenerDecisions !== true/);
  assert.match(logHelperSource, /logger\.log\('\[TPS GCM\] Opener decision'/);
});

test('diagnostic API reports the same leaf state used by opener decisions', () => {
  assert.match(pluginApiSource, /openFileInLeaf: \(\s*file: TFile,\s*context: 'tab' \| 'split' \| 'window' \| false,\s*getLeaf: \(\) => WorkspaceLeaf \| null/);
  assert.match(pluginApiSource, /\) => plugin\.openFileInLeaf\(file, context, getLeaf, options\)/);
  assert.match(pluginApiSource, /diagnostics: \{/);
  assert.match(pluginApiSource, /version: 1/);
  assert.match(pluginApiSource, /getOpenerDecision: \(targetPath\?: string \| null\) => plugin\.getOpenerDiagnostic\(targetPath\)/);
  assert.match(mainSource, /export interface GcmOpenerDiagnostic/);
  assert.match(mainSource, /getOpenerDiagnostic\(targetPath\?: string \| null\): GcmOpenerDiagnostic/);
  assert.match(mainSource, /existingTargetLeaf: file \? this\.describeOpenerLeaf\(this\.findOpenLeafForFile\(file\)\) : null/);
  assert.doesNotMatch(mainSource, /pendingDefaultOpens/);
  assert.doesNotMatch(mainSource, /defaultMarkdownOpenPromises/);
  assert.match(mainSource, /private describeOpenerLeaf\(leaf: WorkspaceLeaf \| null \| undefined\): GcmOpenerLeafDiagnostic \| null/);
  assert.match(mainSource, /statePath: this\.getLeafViewStatePath\(leaf\)/);
  assert.match(mainSource, /pinned: this\.isPinnedLeafForDifferentFile\(leaf, null\)/);
  assert.match(mainSource, /usableMarkdown: this\.isUsableMarkdownLeaf\(leaf\)/);
});

test('focused opener emits compact diagnostics only through the toggle', () => {
  assert.doesNotMatch(mainSource, /this\.logOpenerDecision\('native-pinned-reroute'/);
  assert.match(mainSource, /this\.logOpenerDecision\('reuse-existing-leaf'/);
  assert.match(mainSource, /this\.logOpenerDecision\('avoid-pinned-leaf'/);
  assert.match(mainSource, /this\.logOpenerDecision\('avoid-non-markdown-leaf'/);
  assert.match(mainSource, /this\.logOpenerDecision\('open-missing-file'/);
});

test('time tracking status bar opens the hydrated active target directly', () => {
  assert.match(timeTrackingStatusBarSource, /openHydratedSessionTarget\(state\.session\)/);
  assert.match(timeTrackingStatusBarSource, /new Notice\('Could not open timer target\.'\)/);
  assert.match(timeTrackingServiceSource, /async openHydratedSessionTarget\(session: TimeTrackingSession\)/);
  assert.match(timeTrackingServiceSource, /this\.resolveFile\(session\.targetPath\) \?\? this\.resolveFile\(session\.sourcePath\)/);
  assert.match(timeTrackingServiceSource, /return this\.openSessionTarget\(session\.id\)/);
});
