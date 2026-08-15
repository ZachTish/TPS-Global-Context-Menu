import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('relink flow lists only service-approved candidates and confirms before mutation', () => {
  const modal = read('src/modals/file-properties-relink-modal.ts');
  assert.match(modal, /service\.isPropertyTarget\(target\)/u);
  assert.match(modal, /const exact = service\.getRelinkCandidate\(target\)/u);
  assert.match(modal, /if \(!exact && service\.hasCompanion\(target\)\)/u);
  assert.match(modal, /const candidates = service\.listRelinkCandidates\(target\)/u);
  assert.match(modal, /if \(candidates\.length === 0\)/u);
  assert.match(modal, /exactCandidate && candidates\.length === 1/u);
  assert.match(modal, /extends FuzzySuggestModal<FilePropertiesRelinkCandidate>/u);
  assert.match(modal, /new FilePropertiesRelinkConfirmModal\(this\.plugin, this\.target, candidate\)\.open\(\)/u);
  assert.match(modal, /Relink file properties\?/u);
  assert.match(modal, /\.relinkCompanion\(this\.candidate\.companionFile, this\.target\)/u);
  assert.match(modal, /text: 'Start fresh'/u);
  assert.match(modal, /\.startFreshCompanion\(this\.target\)/u);
  assert.match(modal, /retained history was preserved/u);
  assert.match(modal, /if \(this\.submitting\) return/u);
  assert.match(modal, /cancelButton\.addEventListener\('click', \(\) => this\.close\(\)\)/u);
});

test('relink candidate summaries disclose bounded property names but no values', () => {
  const service = read('src/services/file-properties-service.ts');
  const modal = read('src/modals/file-properties-relink-modal.ts');
  assert.match(service, /listRelinkCandidates\(target\?: TFile\)/u);
  assert.match(service, /hasRelinkCandidates\(target\?: TFile\)/u);
  assert.match(service, /private readonly relinkCandidateCompanions = new Set<TFile>\(\)/u);
  assert.match(service, /this\.readReservedBoolean\(raw, FILE_PROPERTY_KEYS\.sourceMissing\)/u);
  assert.match(service, /this\.isUniqueIndexedIdentity\(companion, sourcePath, fileId\)/u);
  assert.match(service, /Object\.keys\(this\.extractUserProperties\(raw\)\)/u);
  assert.match(service, /\.replace\(\/\[\\u0000-\\u001F\\u007F\]\/gu, ' '\)/u);
  assert.match(service, /\.slice\(0, 80\)/u);
  assert.match(service, /\.slice\(0, 6\)/u);
  assert.match(modal, /candidate\.propertyNames\.join\(', '\)/u);
  assert.match(modal, /Pending Markdown merge:/u);
  assert.doesNotMatch(modal, /frontmatter|propertyValues|JSON\.stringify\(candidate/u);
});

test('command and non-Markdown context menu route through the shared relink flow', () => {
  const commands = read('src/commands/register-commands.ts');
  const events = read('src/events/register-events.ts');
  const menu = read('src/menu/menu-builder.ts');
  assert.match(commands, /id: 'relink-file-properties-note'/u);
  assert.match(commands, /name: 'File properties: Relink properties to current file…'/u);
  assert.match(commands, /promptFilePropertiesRelink\(plugin, file\)/u);
  assert.match(menu, /service\.hasRelinkCandidates\(file\)/u);
  assert.doesNotMatch(menu, /service\.listRelinkCandidates\(file\)/u);
  assert.match(menu, /item\.setTitle\('Relink file properties…'\)/u);
  assert.match(menu, /promptFilePropertiesRelink\(this\.plugin, file\)/u);
  assert.doesNotMatch(menu, /relinkCompanion\(relinkCandidate, file\)/u);
  assert.match(events, /filePropertiesService\.handleSourceCreate\(file\)/u);
  assert.match(events, /A pending Markdown target was recorded; automatic merge is disabled\./u);
});
