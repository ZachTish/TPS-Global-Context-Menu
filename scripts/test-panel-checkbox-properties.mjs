import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
const panelBuilder = read('src/menu/panel-builder.ts');
const tpsList = read('src/tps-list/views/TpsListView.ts');
const logBase = read('src/views/log-base-view.ts');
const pluginStyles = read('src/plugin-styles.ts');

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('boolean-property state is typed, explicit, and deterministic for legacy values', async () => {
  const {
    getBooleanPropertyPresentation,
    getNextBooleanPropertyValue,
    getReadOnlyBooleanFormulaPresentation,
    isBooleanPropertyType,
    normalizeBooleanPropertyValue,
    normalizeInlineBooleanPropertyValue,
  } = await importBundled('../src/utils/boolean-property.ts');

  class PublicBooleanValue {
    static type = 'boolean';
    constructor(value) { this.value = value; }
    isTruthy() { return this.value; }
    toString() { return String(this.value); }
  }

  assert.equal(isBooleanPropertyType('checkbox'), true);
  assert.equal(isBooleanPropertyType('boolean'), true);
  assert.equal(isBooleanPropertyType('text'), false);

  assert.deepEqual(
    getBooleanPropertyPresentation(true),
    { state: 'yes', checked: true, indeterminate: false, text: 'Yes' },
  );
  assert.deepEqual(
    getBooleanPropertyPresentation(false),
    { state: 'no', checked: false, indeterminate: false, text: 'No' },
  );
  assert.deepEqual(
    getBooleanPropertyPresentation(null),
    { state: 'unset', checked: false, indeterminate: true, text: 'Not set' },
  );
  assert.deepEqual(
    getBooleanPropertyPresentation('false'),
    { state: 'invalid', checked: false, indeterminate: true, text: 'Invalid' },
    'string lookalikes must not be treated as booleans',
  );

  assert.equal(getNextBooleanPropertyValue(true), false);
  assert.equal(getNextBooleanPropertyValue(false), true);
  assert.equal(getNextBooleanPropertyValue(undefined), true);
  assert.equal(getNextBooleanPropertyValue('true'), true);
  assert.equal(typeof getNextBooleanPropertyValue('false'), 'boolean');
  assert.equal(normalizeBooleanPropertyValue(new PublicBooleanValue(true)), true);
  assert.equal(normalizeBooleanPropertyValue(new PublicBooleanValue(false)), false);
  assert.deepEqual(
    getBooleanPropertyPresentation(new PublicBooleanValue(true)),
    { state: 'yes', checked: true, indeterminate: false, text: 'Yes' },
  );
  assert.equal(getNextBooleanPropertyValue(new PublicBooleanValue(true)), false);
  assert.equal(getReadOnlyBooleanFormulaPresentation(true)?.checked, true);
  assert.equal(getReadOnlyBooleanFormulaPresentation(false)?.checked, false);
  assert.equal(getReadOnlyBooleanFormulaPresentation(new PublicBooleanValue(true))?.checked, true);
  assert.equal(getReadOnlyBooleanFormulaPresentation(new PublicBooleanValue(false))?.checked, false);
  assert.equal(getReadOnlyBooleanFormulaPresentation(null), null);
  assert.equal(getReadOnlyBooleanFormulaPresentation(''), null);
  assert.equal(getReadOnlyBooleanFormulaPresentation({ error: 'formula failed' }), null);
  assert.equal(normalizeInlineBooleanPropertyValue('true'), true);
  assert.equal(normalizeInlineBooleanPropertyValue('false'), false);
  assert.equal(normalizeInlineBooleanPropertyValue('  true  '), true);
  assert.equal(normalizeInlineBooleanPropertyValue(''), undefined);
  assert.equal(normalizeInlineBooleanPropertyValue('yes'), 'yes');
  assert.equal(normalizeInlineBooleanPropertyValue('TRUE'), 'TRUE');
});

test('stacked and generic whole-note properties share one accessible native checkbox write path', () => {
  const editable = sourceBlock(
    panelBuilder,
    'private makeStackedPropertyValueEditable(',
    'private isStackedPropertyEditable(',
  );
  const control = sourceBlock(
    panelBuilder,
    'private createBooleanPropertyControl(',
    'private filesFromEntries(',
  );
  const stacked = sourceBlock(
    panelBuilder,
    'private populateStackedPropertyValue(',
    'private populateTextOrWebLink(',
  );
  const generic = sourceBlock(
    panelBuilder,
    'private createGenericContextPropertyChip(',
    'private createLinkValueChip(',
  );

  assert.match(editable, /isBooleanPropertyType\(prop\?\.type\)\) return;/);
  assert.match(control, /document\.createElement\('input'\)/);
  assert.match(control, /checkbox\.type = 'checkbox'/);
  assert.match(control, /checkbox\.checked = presentation\.checked/);
  assert.match(control, /checkbox\.indeterminate = presentation\.indeterminate/);
  assert.match(control, /checkbox\.setAttribute\('aria-label'/);
  assert.match(control, /checkbox\.setAttribute\('aria-invalid', 'true'\)/);
  assert.match(control, /stateText\.textContent = context === 'chip'/);
  assert.match(control, /checkbox\.addEventListener\('change'/);
  assert.match(control, /control\.addEventListener\('click', stopPropagation\)/);
  assert.match(control, /control\.addEventListener\('keydown', stopPropagation\)/);
  assert.match(control, /const next = getNextBooleanPropertyValue\(previous\)/);
  assert.match(control, /updateFrontmatter\(files, \{ \[key\]: next \}\)/);
  assert.doesNotMatch(control, /String\(next\)|\[key\]\s*:\s*['"`](?:true|false)['"`]/);

  assert.match(stacked, /createBooleanPropertyControl\(entries, prop, raw, 'stacked'\)/);
  assert.match(generic, /createBooleanPropertyControl\(entries, prop, raw, 'chip'\)/);
  assert.match(generic, /isBooleanPropertyType\(prop\?\.type\)[\s\S]*?return this\.createBooleanPropertyControl/);
});

test('TPS List note and synthesized-line checkbox properties use the same typed control contract', async () => {
  const noteRenderer = sourceBlock(
    tpsList,
    'private renderListNoteProperties(',
    'private createListBooleanPropertyControl(',
  );
  const control = sourceBlock(
    tpsList,
    'private createListBooleanPropertyControl(',
    'private isWritableNotePropertyId(',
  );
  const taskRenderer = sourceBlock(
    tpsList,
    'private renderListTaskBooleanProperty(',
    'private startListTaskPropertyEdit(',
  );

  assert.match(noteRenderer, /isBooleanPropertyType\(configuredProperty\?\.type\)/);
  assert.match(noteRenderer, /getReadOnlyBooleanFormulaPresentation\(rawValue\)/);
  assert.match(noteRenderer, /renderListReadOnlyBooleanProperty\(parent, propId, rawValue\)/);
  assert.match(noteRenderer, /fm\[actualKey\] = next/);
  assert.doesNotMatch(noteRenderer, /fm\[actualKey\] = String\(next\)/);
  assert.match(control, /attr: \{ type: 'checkbox' \}/);
  assert.match(control, /checkbox\.checked = presentation\.checked/);
  assert.match(control, /checkbox\.indeterminate = presentation\.indeterminate/);
  assert.match(control, /getNextBooleanPropertyValue\(previous\)/);
  assert.match(control, /private renderListReadOnlyBooleanProperty\(/);
  assert.match(control, /disabled: 'true'/);
  assert.match(control, /'aria-readonly': 'true'/);
  assert.match(taskRenderer, /setLogInlineFieldValue\(line, propertyKey, next \? 'true' : 'false'\)/);
  assert.match(taskRenderer, /mutateRenderedTaskLine\(/);

  const lines = await importBundled('../src/views/log-line-utils.ts');
  const enabled = lines.setLogInlineFieldValue('- [ ] Checkbox QA', 'reviewed', 'true');
  const disabled = lines.setLogInlineFieldValue(enabled, 'reviewed', 'false');
  assert.equal(lines.readInlineFields(enabled).reviewed, 'true');
  assert.equal(lines.readInlineFields(disabled).reviewed, 'false');
  assert.doesNotMatch(disabled, /reviewed:: "false"/u);
});

test('TPS Table renders formula and writable line booleans as accessible native checkbox controls', () => {
  const rowRenderer = sourceBlock(
    logBase,
    'private renderEntry(',
    'private renderConfiguredPropertyCell(',
  );
  const configuredRenderer = sourceBlock(
    logBase,
    'private renderConfiguredPropertyCell(',
    'private renderTableBooleanCell(',
  );
  const checkboxRenderer = sourceBlock(
    logBase,
    'private renderTableBooleanCell(',
    'private renderGenericInlinePropertyCell(',
  );

  assert.match(rowRenderer, /getReadOnlyBooleanFormulaPresentation\(formulaResult\.value\)/u);
  assert.match(rowRenderer, /this\.renderTableBooleanCell\(cell, column\.label, formulaResult\.value\)/u);
  assert.match(configuredRenderer, /isBooleanPropertyType\(property\.type\)/u);
  assert.match(configuredRenderer, /normalizeInlineBooleanPropertyValue\(/u);
  assert.match(configuredRenderer, /this\.renderTableBooleanCell\(/u);
  assert.match(configuredRenderer, /setLogInlineFieldValue\(line, property\.key, String\(next\)\)/u);

  assert.match(checkboxRenderer, /createEl\('input'/u);
  assert.match(checkboxRenderer, /type: 'checkbox'/u);
  assert.match(checkboxRenderer, /checkbox\.checked = presentation\.checked/u);
  assert.match(checkboxRenderer, /checkbox\.indeterminate = presentation\.indeterminate/u);
  assert.match(checkboxRenderer, /checkbox\.setAttribute\('aria-label'/u);
  assert.match(checkboxRenderer, /checkbox\.addEventListener\('change'/u);
  assert.match(checkboxRenderer, /const next = getNextBooleanPropertyValue\(previous\)/u);
  assert.match(checkboxRenderer, /void commit\(next\)\.then\(\(changed\)/u);
  assert.match(checkboxRenderer, /currentValue = previous;[\s\S]*?renderState\(previous\)/u);
  assert.doesNotMatch(checkboxRenderer, /\.setText\(|textContent\s*=\s*String\(/u);
  assert.match(
    pluginStyles,
    /\.tps-log-base-boolean-checkbox\s*\{[\s\S]*?width:\s*16px;[\s\S]*?height:\s*16px;/u,
  );
});
