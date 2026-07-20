import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const runtimeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

function collectRuntimeSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectRuntimeSources(path);
    if (entry.isFile() && runtimeExtensions.has(extname(entry.name))) return [path];
    return [];
  });
}

const sources = collectRuntimeSources(sourceRoot).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

test('GCM never replaces or internally depends on the host FileManager frontmatter method', () => {
  for (const source of sources) {
    assert.doesNotMatch(
      source.text,
      /processFrontMatter/,
      `${source.path} must not reference, alias, wrap, replace, or call the retired host method`,
    );
    assert.doesNotMatch(
      source.text,
      /installProcessFrontmatterPatch|nativeProcessFrontmatterDelegate|processFrontmatterWithNativeDelegate|__tpsGcmFrontmatterPatch/,
      `${source.path} must not restore the retired host-method bridge`,
    );
  }
});
