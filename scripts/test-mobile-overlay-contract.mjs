import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const srcRoot = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = `${directory}/${name}`;
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

test('every TPS Modal opts into the shared mobile input contract', () => {
  const missing = sourceFiles(srcRoot)
    .filter((path) => readFileSync(path, 'utf8').includes('extends Modal'))
    .filter((path) => !readFileSync(path, 'utf8').includes("modalEl.addClass('mod-tps-gcm"))
    .filter((path) => !readFileSync(path, 'utf8').includes('modalEl.addClass("mod-tps-gcm'));
  assert.deepEqual(missing, []);
});

test('editable popup cards use the shared keyboard-aware overlay', () => {
  const taskEditor = readFileSync(`${srcRoot}/services/task-line-context-menu-service.ts`, 'utf8');
  const notePreview = readFileSync(`${srcRoot}/menu/persistent-menu-manager.ts`, 'utf8');
  const mobileOverlay = readFileSync(`${srcRoot}/utils/mobile-overlay.ts`, 'utf8');
  assert.match(taskEditor, /new KeyboardAwareOverlay\(card, anchorEl/);
  assert.match(notePreview, /new KeyboardAwareOverlay\(popover, anchorEl/);
  assert.match(mobileOverlay, /NATIVE_KEYBOARD_SHOW_EVENTS = \['keyboardWillShow', 'keyboardDidShow'\]/);
  assert.match(mobileOverlay, /window\.addEventListener\('keyboardDidHide', this\.keyboardDidHideHandler\)/);
  assert.match(mobileOverlay, /window\.removeEventListener\('keyboardDidHide', this\.keyboardDidHideHandler\)/);
  assert.match(mobileOverlay, /getVisibleViewport\(window, sharedNativeKeyboard\)/);
  assert.match(mobileOverlay, /resetNativeKeyboard\(sharedNativeKeyboard\);\s+const root = document\.documentElement\.style/);
});

test('existing TPS plugin modal files opt into the shared mobile contract', () => {
  const pluginRoots = [
    '../../TPS-Calendar-Base (Dev)/src',
    '../../TPS-Controller (Dev)/src',
    '../../TPS-Kanban (Dev)/src',
    '../../TPS-Finances (Dev)/src',
    '../../TPS-health (Dev)/src',
    '../../tps-messager/src',
  ].map((path) => fileURLToPath(new URL(path, import.meta.url)));
  const missing = pluginRoots.flatMap(sourceFiles)
    .filter((path) => /extends Modal|new Modal\(/.test(readFileSync(path, 'utf8')))
    .filter((path) => !readFileSync(path, 'utf8').includes('tps-keyboard-aware-modal'));
  assert.deepEqual(missing, []);
  const healthSource = readFileSync(fileURLToPath(new URL('../../TPS-health (Dev)/src/main.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(healthSource, /setupKeyboardAwareHealthModal/);
  assert.match(readFileSync(`${srcRoot}/utils/mobile-overlay.ts`, 'utf8'), /target\.scrollIntoView/);
});
