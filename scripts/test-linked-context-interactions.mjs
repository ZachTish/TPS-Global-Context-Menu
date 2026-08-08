import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manager = readFileSync(new URL('../src/menu/persistent-menu-manager.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');

test('linked context tasks publish exact task metadata for the canonical task menu', () => {
  assert.match(manager, /taskRow\.dataset\.tpsGcmContext = 'calendar-task'/);
  assert.match(manager, /taskRow\.dataset\.taskPath = item\.sourceFile\.path/);
  assert.match(manager, /taskRow\.dataset\.taskLine = String\(taskLine\.lineNumber \+ 1\)/);
});

test('linked context task long press cancels on scroll movement and opens contextmenu', () => {
  assert.match(manager, /Math\.hypot\(event\.clientX - startX, event\.clientY - startY\) > 10/);
  assert.match(manager, /new MouseEvent\('contextmenu'/);
  assert.match(manager, /}, 500\)/);
});

test('linked context has a compact coarse-pointer layout with touch-sized checkboxes', () => {
  assert.match(styles, /@media \(max-width: 700px\), \(pointer: coarse\)/);
  assert.match(styles, /\.tps-gcm-linked-context-body input\[type="checkbox"\][\s\S]*width: 22px;[\s\S]*height: 22px;/);
  assert.match(styles, /\.tps-gcm-linked-context-task[\s\S]*touch-action: pan-y;/);
});
