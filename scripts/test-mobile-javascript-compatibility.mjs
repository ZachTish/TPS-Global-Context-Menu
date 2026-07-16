import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const srcRoot = fileURLToPath(new URL('../src/', import.meta.url));

function collectSourceFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(folder, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(absolutePath);
    return /\.tsx?$/.test(entry.name) ? [absolutePath] : [];
  });
}

test('mobile-loaded source avoids JavaScript regular-expression lookbehind', () => {
  const lookbehindPattern = /\(\?<([=!])/g;
  const offenders = [];

  for (const file of collectSourceFiles(srcRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(lookbehindPattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      offenders.push(`${path.relative(srcRoot, file)}:${line}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Regex lookbehind is unsupported by Obsidian on iOS: ${offenders.join(', ')}`,
  );
});
