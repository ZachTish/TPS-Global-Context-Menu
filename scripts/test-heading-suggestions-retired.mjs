import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const main = ts.createSourceFile('main.ts', read('src/main.ts'), ts.ScriptTarget.Latest, true);

function sourceFiles(directory) {
  return readdirSync(new URL(directory, root), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.[cm]?tsx?$/u.test(entry.name) ? [path] : [];
  });
}

function findNodes(source, predicate) {
  const found = [];
  const visit = (node) => {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('runtime source cannot import, construct, or register the retired heading suggestion owner', () => {
  const references = [];
  for (const path of sourceFiles('src')) {
    const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
    for (const node of findNodes(source, (candidate) => (
      (ts.isIdentifier(candidate) && candidate.text === 'HeadingLinkSuggest')
      || (ts.isStringLiteral(candidate) && /(?:^|\/)heading-link-suggest(?:\.[cm]?tsx?)?$/u.test(candidate.text))
    ))) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      references.push(`${path}:${line + 1}`);
    }
  }
  assert.deepEqual(references, [], 'The retired owner must not remain in runtime imports, startup children, or listener code.');
});

test('the retired service file is removed rather than left as an unused listener implementation', () => {
  assert.equal(existsSync(new URL('src/services/heading-link-suggest.ts', root)), false);
});

test('runtime styles contain no retired heading suggestion popover or item selectors', () => {
  for (const path of ['src/plugin-styles.ts', 'styles.css', 'styles-ui.css']) {
    if (!existsSync(new URL(path, root))) continue;
    assert.equal(/\.tps-gcm-heading-link-suggest(?:[\s.{:#\[]|-)/u.test(read(path)), false,
      `${path} still contains a retired heading suggestion selector`);
  }
});

test('retirement preserves the independent heading collapse and fold expansion startup owners', () => {
  for (const [constructor, property] of [
    ['HeadingCollapseOnOpenService', 'headingCollapseOnOpenService'],
    ['FoldExpansionContextMenuService', 'foldExpansionContextMenuService'],
  ]) {
    assert.ok(findNodes(main, (node) => ts.isNewExpression(node)
      && ts.isIdentifier(node.expression) && node.expression.text === constructor).length > 0,
    `${constructor} remains available`);
    assert.ok(findNodes(main, (node) => ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'addChild'
      && node.arguments.some((argument) => ts.isPropertyAccessExpression(argument)
        && argument.name.text === property)).length > 0,
    `${constructor} retains its own lifecycle registration`);
    assert.ok(existsSync(new URL(`src/services/${property === 'headingCollapseOnOpenService'
      ? 'heading-collapse-on-open-service' : 'fold-expansion-context-menu-service'}.ts`, root)));
  }
});

test('native link preview, rendered note titles, and body selection keep their existing owners', () => {
  assert.ok(findNodes(main, (node) => ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'trigger'
    && node.arguments.some((argument) => ts.isStringLiteral(argument) && argument.text === 'hover-link')).length > 0);
  assert.ok(findNodes(main, (node) => ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'processRenderedNoteLinks').length > 0);
  assert.ok(findNodes(main, (node) => ts.isCallExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === 'createLivePreviewBodySelectionExtension').length > 0);
});
