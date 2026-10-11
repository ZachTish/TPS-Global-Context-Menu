import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const markerModule = build({
  entryPoints: [fileURLToPath(new URL('../src/utils/native-checkbox-marker.ts', import.meta.url))],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
}).then((result) => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`));

test('plain-checkbox choices include the requested markers without status mappings', async () => {
  const { DEFAULT_CHECKBOX_MENU_STATES } = await markerModule;
  assert.deepEqual([...DEFAULT_CHECKBOX_MENU_STATES], ['[ ]', '[x]', '[/]', '[?]', '[!]']);
});

test('marker input accepts a single character and canonicalizes only blank forms', async () => {
  const { normalizeNativeCheckboxToken } = await markerModule;
  for (const [input, expected] of [
    ['', '[ ]'], [' ', '[ ]'], ['[]', '[ ]'], ['[ ]', '[ ]'],
    ['/', '[/]'], ['[/]', '[/]'], ['?', '[?]'], ['[?]', '[?]'],
    ['!', '[!]'], ['[!]', '[!]'], ['-', '[-]'], ['\\', '[\\]'],
    ['x', '[x]'], ['[x]', '[x]'], ['é', '[é]'],
  ]) {
    assert.equal(normalizeNativeCheckboxToken(input), expected, JSON.stringify(input));
  }
});

test('marker input rejects multiple UTF-16 characters, brackets, and newlines', async () => {
  const { normalizeNativeCheckboxToken } = await markerModule;
  for (const input of ['ab', '[ab]', '[', ']', '[[]', '[]]', '\n', '\r', '[\n]', '[\r]', '🙂', '[🙂]', '[?]\n[!]']) {
    assert.equal(normalizeNativeCheckboxToken(input), null, JSON.stringify(input));
  }
});

test('configured menu text is ordered, deduplicated, and independent of statuses', async () => {
  const { parseCheckboxMenuStates } = await markerModule;
  assert.deepEqual(parseCheckboxMenuStates('[?]\n[/]\n[!]\n[?]\n!\n[ ]\n[x]'), ['[?]', '[/]', '[!]', '[ ]', '[x]']);
  assert.deepEqual(parseCheckboxMenuStates('[!]\r\n[?]\r\n[/]'), ['[!]', '[?]', '[/]']);
  assert.deepEqual(parseCheckboxMenuStates(''), []);
  assert.deepEqual(parseCheckboxMenuStates('\n\n'), []);
  assert.equal(parseCheckboxMenuStates('[?]\n[bad]\n[!]'), null);
});

test('persisted choices omit invalid entries while preserving an intentionally empty menu', async () => {
  const { DEFAULT_CHECKBOX_MENU_STATES, normalizeCheckboxMenuStates } = await markerModule;
  assert.deepEqual(normalizeCheckboxMenuStates(['[/]', '[no]', '[!]', '!', '[?]', '🙂']), ['[/]', '[!]', '[?]']);
  assert.deepEqual(normalizeCheckboxMenuStates([]), []);
  for (const value of [undefined, null, '[!]', { checkboxState: '[!]' }]) {
    assert.deepEqual(normalizeCheckboxMenuStates(value), [...DEFAULT_CHECKBOX_MENU_STATES]);
  }
});

test('native task markers resolve exact offsets in unordered, ordered, nested, and quoted lists', async () => {
  const { getNativeCheckboxMarker } = await markerModule;
  for (const line of [
    '- [ ] Ordinary', '* [?] Question', '+ [!] Important',
    '12. [/] Ordered', '4) [x] Completed', '  - [ ] Nested',
    '> - [ ] Quoted', '> > 2. [?] Nested quote', '\t- [!] Tab-indented',
  ]) {
    const result = getNativeCheckboxMarker(line);
    assert.ok(result, line);
    assert.equal(result.markerOffset, line.indexOf('[') + 1, line);
    assert.equal(result.token, line.slice(result.markerOffset - 1, result.markerOffset + 2), line);
    assert.ok(result.body.includes(line.slice(line.indexOf(']') + 1).trim()), line);
  }
  assert.ok(getNativeCheckboxMarker('- [ ]'));
});

test('non-task text and missing space after the checkbox cannot become marker targets', async () => {
  const { getNativeCheckboxMarker } = await markerModule;
  for (const line of ['- [?]text', '-[?] text', '[?] text', 'paragraph - [ ] example', '- [ab] text', '- [] text', '- [ ]text']) {
    assert.equal(getNativeCheckboxMarker(line), null, line);
  }
});

test('line resolution and mutation exclude frontmatter, fenced code, comments, HTML, and indented code', async () => {
  const { resolveNativeCheckboxLine, replaceNativeCheckboxMarker } = await markerModule;
  for (const [content, lineIndex] of [
    ['---\n- [ ] YAML example\n---\n- [ ] Actual', 1],
    ['```markdown\n- [ ] Code example\n```\n- [ ] Actual', 1],
    ['~~~markdown\n- [ ] Code example\n~~~\n- [ ] Actual', 1],
    ['<!--\n- [ ] Comment example\n-->\n- [ ] Actual', 1],
    ['<div>\n- [ ] HTML example\n</div>\n\n- [ ] Actual', 1],
    ['    - [ ] Indented code\n\n- [ ] Actual', 0],
  ]) {
    const rawLine = content.split('\n')[lineIndex];
    assert.equal(resolveNativeCheckboxLine(content, lineIndex, rawLine), null, content);
    assert.equal(replaceNativeCheckboxMarker(content, lineIndex, rawLine, '[!]'), null, content);
  }
});

test('nested tasks remain actionable while task-shaped code inside a list stays protected', async () => {
  const { resolveNativeCheckboxLine, replaceNativeCheckboxMarker } = await markerModule;
  const content = '- parent\n  - [ ] Nested actual\n\n  ```markdown\n  - [ ] Fenced example\n  ```';
  assert.equal(resolveNativeCheckboxLine(content, 1, '  - [ ] Nested actual')?.text, '  - [ ] Nested actual');
  assert.equal(replaceNativeCheckboxMarker(content, 1, '  - [ ] Nested actual', '[?]'), content.replace('  - [ ] Nested actual', '  - [?] Nested actual'));
  assert.equal(resolveNativeCheckboxLine(content, 4, '  - [ ] Fenced example'), null);
});

test('exact line resolution exposes source offsets and refuses stale or invalid indexes', async () => {
  const { resolveNativeCheckboxLine } = await markerModule;
  const content = 'Title\r\n- [ ] Selected\r\n- [ ] Other\r\n';
  const result = resolveNativeCheckboxLine(content, 1, '- [ ] Selected');
  assert.ok(result);
  assert.equal(result.index, 1);
  assert.equal(result.text, '- [ ] Selected');
  assert.equal(result.start, content.indexOf('- [ ] Selected'));
  assert.equal(result.end, result.start + result.text.length);
  assert.equal(result.isContent, true);
  assert.equal(resolveNativeCheckboxLine(content, 1, '- [ ] Old title'), null);
  for (const index of [-1, 1.5, Number.NaN, 99]) {
    assert.equal(resolveNativeCheckboxLine(content, index), null);
  }
});

test('the write changes one marker character while preserving BOM, CRLF, fields, block ID, and spaces', async () => {
  const { replaceNativeCheckboxMarker } = await markerModule;
  const rawLine = '  2) [ ]\t  Keep [[Other|display]] [status:: todo] [scheduled:: 2099-01-01] #tag ^stable-id  ';
  const content = '\uFEFF---\r\ntitle: Fixture\r\nid: preserve-me\r\n---\r\n\r\n' + rawLine + '\r\n\r\nTrailing paragraph  \r\n';
  const result = replaceNativeCheckboxMarker(content, 5, rawLine, '[!]');
  const offset = content.indexOf(rawLine) + rawLine.indexOf('[') + 1;
  assert.equal(result, content.slice(0, offset) + '!' + content.slice(offset + 1));
  assert.equal(result.length, content.length);
  assert.equal([...result].filter((char, index) => char !== [...content][index]).length, 1);
});

test('duplicate task labels are targeted only by their selected physical index', async () => {
  const { replaceNativeCheckboxMarker } = await markerModule;
  const content = '- [ ] Duplicate\n- [ ] Duplicate\n- [ ] Duplicate';
  assert.equal(replaceNativeCheckboxMarker(content, 1, '- [ ] Duplicate', '[/]'), '- [ ] Duplicate\n- [/] Duplicate\n- [ ] Duplicate');
});

test('stale source never falls back to a matching line elsewhere and a selected value is a no-op', async () => {
  const { replaceNativeCheckboxMarker } = await markerModule;
  const content = 'Inserted paragraph\n- [ ] Same title\n- [ ] Changed title';
  assert.equal(replaceNativeCheckboxMarker(content, 0, '- [ ] Same title', '[?]'), null);
  assert.equal(replaceNativeCheckboxMarker(content, 2, '- [ ] Same title', '[?]'), null);
  assert.equal(replaceNativeCheckboxMarker(content, 1, '- [ ] Same title', '[ ]'), content);
  assert.equal(replaceNativeCheckboxMarker(content, 1, '- [ ] Same title', '[two]'), null);
  assert.equal(replaceNativeCheckboxMarker('- [x] Same title', 0, '- [ ] Same title', '[?]'), null);
});
