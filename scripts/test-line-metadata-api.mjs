import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule(entry) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('canonical string lists handle scalar, comma, bracket, case, blank, and link values exactly', async () => {
  const { parseStringListInput } = await loadModule('../src/utils/list-utils.ts');
  assert.deepEqual(parseStringListInput('task'), ['task']);
  assert.deepEqual(parseStringListInput('project, task'), ['project', 'task']);
  assert.deepEqual(parseStringListInput('[project, task]'), ['project', 'task']);
  assert.deepEqual(parseStringListInput('[Task, task, Task, , ]'), ['Task', 'task']);
  assert.deepEqual(parseStringListInput(['', null, false, '  ', 'task']), ['task']);
  assert.deepEqual(
    parseStringListInput('[[Projects/Alpha, Beta|Alpha, Beta]], task'),
    ['[[Projects/Alpha, Beta|Alpha, Beta]]', 'task'],
  );
});

test('one canonical line bundle preserves nested fields and produces a plain visible title', async () => {
  const { parseLineEntityMetadata, readLineEntityInlineFieldValue } = await loadModule(
    '../src/services/line-entity-source-provider.ts',
  );
  const line = '- [ ] **Ship** [[Projects/Alpha|Alpha]] and [docs](https://example.test) '
    + '![diagram](Images/Diagram.png) with `code` #Work '
    + '[kind:: [project, task]] [project:: [[Projects/One|One, Primary]], [[Projects/Two]]] '
    + '[owner:: ] %% tps-inline-props:{"private":"value"} %% ^task-1';
  const parsed = parseLineEntityMetadata(line);
  assert.equal(parsed?.kind, 'task');
  assert.equal(parsed?.displayTitle, 'Ship Alpha and docs diagram with code');
  assert.deepEqual(parsed?.tags, ['work']);
  assert.deepEqual(parsed?.fields, [
    { key: 'kind', value: '[project, task]' },
    { key: 'project', value: '[[Projects/One|One, Primary]], [[Projects/Two]]' },
    { key: 'owner', value: '' },
  ]);
  assert.equal(readLineEntityInlineFieldValue(line, 'OWNER'), '');
  assert.equal(readLineEntityInlineFieldValue(line, 'missing'), null);
});

test('checkbox tasks, bullets, and headings share the same visible-title contract', async () => {
  const { parseLineEntityMetadata } = await loadModule('../src/services/line-entity-source-provider.ts');
  assert.equal(parseLineEntityMetadata('- [ ] **Task** #tag [kind:: task]')?.displayTitle, 'Task');
  assert.equal(parseLineEntityMetadata('- Bullet [[Target|Alias]] #tag [kind:: idea]')?.displayTitle, 'Bullet Alias');
  assert.equal(parseLineEntityMetadata('## Heading [reference](Target.md) #tag [kind:: project]')?.displayTitle, 'Heading reference');
  assert.equal(parseLineEntityMetadata('plain paragraph'), null);
});

test('document line scanning is immutable, offset-exact, and excludes CommonMark block examples', async () => {
  const { getMarkdownContentLines } = await loadModule('../src/utils/markdown-document-lines.ts');
  const content = [
    '---',
    'fake: - [ ] Frontmatter task',
    '---',
    '- [ ] Visible root',
    '  - [ ] Visible child',
    '-     [ ] Hidden list code',
    '>     - [ ] Hidden blockquote code',
    '```md',
    '- [ ] Hidden fenced task',
    '```',
    '<!--',
    '- [ ] Hidden comment task',
    '-->',
    '- [ ] Visible tail',
  ].join('\n');

  const lines = getMarkdownContentLines(content);
  assert.equal(Object.isFrozen(lines), true);
  assert.equal(lines.every(Object.isFrozen), true);
  assert.deepEqual(
    lines.filter((line) => line.text.trim()).map(({ lineNumber, text }) => ({ lineNumber, text })),
    [
      { lineNumber: 4, text: '- [ ] Visible root' },
      { lineNumber: 5, text: '  - [ ] Visible child' },
      { lineNumber: 14, text: '- [ ] Visible tail' },
    ],
  );
  for (const line of lines) {
    assert.equal(content.slice(line.start, line.end), line.text);
    assert.equal(line.lineNumber, line.index + 1);
  }
  assert.throws(() => lines.push({}), TypeError);
  assert.throws(() => { lines[0].text = 'changed'; }, TypeError);
});

test('document line scanning preserves CR-only physical coordinates while parsing block context', async () => {
  const { getMarkdownContentLines } = await loadModule('../src/utils/markdown-document-lines.ts');
  const content = ['```md', '- [ ] Hidden', '```', '- [ ] Visible'].join('\r');
  const lines = getMarkdownContentLines(content);
  assert.deepEqual(lines.filter((line) => line.text).map(({ lineNumber, text, start, end }) => ({
    lineNumber,
    text,
    start,
    end,
  })), [{
    lineNumber: 4,
    text: '- [ ] Visible',
    start: 23,
    end: 36,
  }]);
});
