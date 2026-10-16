import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

test('automatic deleted-link writer, queue, matcher and event caller are retired', () => {
  for (const file of ['../src/services/bulk-edit-service.ts', '../src/events/register-events.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /cleanupLinksForDeletedFile|runDeletedLinkCleanup|deletedLinkCleanupChain|deletedLinkCleanupPending|DeletedLinkCleanup/);
  }
  assert.equal(existsSync(new URL('../src/utils/deleted-link-cleanup.ts', import.meta.url)), false);
});
