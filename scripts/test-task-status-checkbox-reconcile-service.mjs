import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('retired checklist reconciliation has no service, helper, registration or settings migration', () => {
  for (const path of ['services/task-status-checkbox-reconcile-service.ts', 'utils/task-status-checkbox-reconcile.ts']) {
    assert.equal(existsSync(new URL(`../src/${path}`, import.meta.url)), false);
  }
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /TaskStatusCheckboxReconcileService|taskStatusCheckboxReconcileService|needsTaskLineReconcileMigration|reconcileTaskStatusToCheckbox/);
  const settings = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /reconcileTaskStatusToCheckbox/);
});
