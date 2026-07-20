import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const bulk = read('src/services/bulk-edit-service.ts');
const parent = read('src/services/parent-link-resolution-service.ts');

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('every recurrence create path prepares fully initialized content before Vault.create', () => {
  assert.equal(
    bulk.match(/const prepared = this\.prepareRecurrenceCreateContent/g)?.length,
    5,
  );
  assert.match(bulk, /if \(!prepared\.content \|\| !isFrontmatterMutationReady\(prepared\.outcome\)\)/);
  assert.doesNotMatch(bulk, /const initializationOutcome/);
});

test('recurrence template creation returns no template after ownership or readiness refusal', () => {
  const method = between(
    bulk,
    'private async createOrUpdateRecurrenceTemplateFromInstance',
    '/**\n     * Copies recurring event files',
  );
  const mutation = method.indexOf('processGuardedWithOutcome(occupied');
  const gate = method.indexOf('if (!templateResult.ready');
  const refusal = method.indexOf('return null;', gate);
  const success = method.lastIndexOf('return templateFile;');
  assert.ok(mutation >= 0 && gate > mutation && refusal > gate && success > refusal);
});

test('recurrence instance backlinks are attempted only after template readiness gates', () => {
  const method = between(bulk, 'async ensureRecurrenceTemplate', 'async setScheduled');
  const templateValidation = method.indexOf('isValidatedRecurrenceTemplate');
  const backlink = method.indexOf('processGuardedWithOutcome(file');
  const gate = method.indexOf('if (!backlinkResult.ready)');
  assert.ok(templateValidation >= 0 && backlink > templateValidation && gate > backlink);
  assert.match(method, /partialCommit: createdTemplate/);
});

test('a refused child parent-link write cannot be masked by a successful parent self-link', () => {
  const method = between(parent, 'async addParentToChild', 'async ensureSelfLinkForParent');
  const mutation = method.indexOf('processGuardedWithOutcome(childFile');
  const gate = method.indexOf('if (!isFrontmatterMutationReady(childOutcome)) return false;');
  const selfLink = method.indexOf('ensureSelfLinkForParent(parentFile)');
  assert.ok(mutation >= 0 && gate > mutation && selfLink > gate);
});

test('runtime sources do not restore ad-hoc already-ready side channels', () => {
  const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
  const visit = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return visit(path);
    return entry.isFile() && ['.ts', '.tsx', '.js', '.jsx'].includes(extname(entry.name)) ? [path] : [];
  });
  for (const path of visit(sourceRoot)) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /alreadyReady/i, `${path} must use typed mutation outcomes`);
  }
});
