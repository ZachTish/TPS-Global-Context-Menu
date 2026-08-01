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
