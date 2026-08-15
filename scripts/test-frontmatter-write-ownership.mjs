import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');
const read = (path) => readFileSync(join(repositoryRoot, path), 'utf8');

function listTypeScriptFiles(folder) {
  const files = [];
  for (const entry of readdirSync(folder)) {
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) files.push(...listTypeScriptFiles(path));
    else if (/\.(?:ts|tsx)$/u.test(entry)) files.push(path);
  }
  return files;
}

function isMutationTarget(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isDeleteExpression(parent) && parent.expression === node) return true;
  return ts.isBinaryExpression(parent)
    && parent.left === node
    && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

test('GCM never replaces Obsidian FileManager and has one scoped companion writer lookup', () => {
  const accesses = [];
  for (const path of listTypeScriptFiles(sourceRoot)) {
    const source = readFileSync(path, 'utf8');
    const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      const propertyAccess = (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node))
        && node.name.text === 'processFrontMatter';
      const elementAccess = (ts.isElementAccessExpression(node) || ts.isElementAccessChain(node))
        && ts.isStringLiteralLike(node.argumentExpression)
        && node.argumentExpression.text === 'processFrontMatter';
      if (propertyAccess || elementAccess) {
        accesses.push({
          path: relative(repositoryRoot, path),
          calledDirectly: ts.isCallExpression(node.parent) && node.parent.expression === node,
          mutated: isMutationTarget(node),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  assert.deepEqual(accesses, [{
    path: 'src/services/file-properties-service.ts',
    calledDirectly: false,
    mutated: false,
  }]);

  const main = read('src/main.ts');
  assert.doesNotMatch(main, /installProcessFrontmatterPatch|nativeProcessFrontmatterDelegate|__tpsGcmFrontmatterPatch/u);
});

test('Markdown and non-Markdown mutations use their explicit owned storage boundaries', () => {
  const frontmatter = read('src/services/frontmatter-mutation-service.ts');
  const fileProperties = read('src/services/file-properties-service.ts');
  const oldCanvasBridgePath = join(sourceRoot, 'services', 'canvas-properties-service.ts');

  assert.match(frontmatter, /filePropertiesService\.process\(file, mutator, cause\)/u);
  assert.match(fileProperties, /assertPropertyTarget\(file\)/u);
  assert.match(fileProperties, /writeRawFrontmatter\(ensured\.companion, raw, ensured\.raw\)/u);
  assert.match(fileProperties, /const live = this\.plugin\.app\.vault\.getAbstractFileByPath\(companion\.path\)/u);
  assert.doesNotMatch(fileProperties, /advanced-canvas|canvasMetadataCompatibilityEnabled/u);
  assert.throws(() => statSync(oldCanvasBridgePath), /ENOENT/u);
});

test('all established Markdown owners still route through the canonical mutation service', () => {
  const directOwners = [
    'src/events/register-events.ts',
    'src/handlers/task-checkbox-handler.ts',
    'src/plugin-api.ts',
    'src/services/archive-file-service.ts',
    'src/services/bulk-edit-service.ts',
    'src/services/file-naming-service.ts',
    'src/services/note-operation-service.ts',
    'src/services/parent-link-resolution-service.ts',
    'src/services/subitem-creation-service.ts',
  ];
  for (const path of directOwners) {
    assert.match(read(path), /frontmatterMutationService\.process\(/u, `${path} must use the owned service`);
  }
});
