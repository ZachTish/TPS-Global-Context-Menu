import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');

function read(path) {
  return readFileSync(join(repositoryRoot, path), 'utf8');
}

function listTypeScriptFiles(folder) {
  const files = [];
  for (const entry of readdirSync(folder)) {
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listTypeScriptFiles(path));
    } else if (/\.(?:ts|tsx)$/u.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

function getProcessFrontmatterAccessName(node) {
  if (
    (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node))
    && node.name.text === 'processFrontMatter'
  ) {
    return node.name.text;
  }
  if (
    (ts.isElementAccessExpression(node) || ts.isElementAccessChain(node))
    && ts.isStringLiteralLike(node.argumentExpression)
    && node.argumentExpression.text === 'processFrontMatter'
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

function isMutationTarget(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isDeleteExpression(parent) && parent.expression === node) return true;
  if (
    (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
    && parent.operand === node
  ) {
    return true;
  }
  return (
    ts.isBinaryExpression(parent)
    && parent.left === node
    && parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

test('GCM owns every Markdown frontmatter write without replacing Obsidian FileManager', () => {
  const accesses = [];
  for (const path of listTypeScriptFiles(sourceRoot)) {
    const source = readFileSync(path, 'utf8');
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node) => {
      if (getProcessFrontmatterAccessName(node)) {
        const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        accesses.push({
          path: relative(repositoryRoot, path),
          line: location.line + 1,
          called: ts.isCallExpression(node.parent) && node.parent.expression === node,
          mutated: isMutationTarget(node),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  assert.equal(accesses.length, 1, JSON.stringify(accesses));
  assert.deepEqual({
    path: accesses[0].path,
    called: accesses[0].called,
    mutated: accesses[0].mutated,
  }, {
    path: 'src/services/canvas-properties-service.ts',
    called: false,
    mutated: false,
  });

  const main = read('src/main.ts');
  for (const retiredHostPatchName of [
    'installProcessFrontmatterPatch',
    'restoreProcessFrontmatterPatch',
    'nativeProcessFrontmatterDelegate',
    '__tpsGcmFrontmatterPatch',
    'processFrontmatterWithNativeDelegate',
  ]) {
    assert.doesNotMatch(main, new RegExp(retiredHostPatchName, 'u'));
  }
});

test('all migrated GCM owners route through the explicit mutation service', () => {
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

  const linkedSubitems = read('src/services/linked-subitem-checkbox-service.ts');
  assert.match(linkedSubitems, /bulkEditService\.setStatus\(/u, 'linked subitems must use the canonical bulk status pipeline');
  assert.doesNotMatch(linkedSubitems, /frontmatterMutationService\.process\(/u, 'linked subitems must not bypass bulk status follow-up');

  const tpsList = read('src/tps-list/views/TpsListView.ts');
  assert.match(tpsList, /const service = this\.getGcmPlugin\(\)\?\.frontmatterMutationService;/u);
  assert.equal(
    [...tpsList.matchAll(/await this\.processFrontmatter\(file, \(fm\) =>/gu)].length,
    5,
    'all five TPS List note-property editors, including checkbox clear, must use the owned service',
  );
});

async function loadCanvasPropertiesService() {
  const result = await build({
    stdin: {
      contents: `
        export { CanvasPropertiesService } from '../src/services/canvas-properties-service.ts';
        export { TFile } from 'obsidian';
      `,
      resolveDir: dirname(fileURLToPath(import.meta.url)),
      sourcefile: 'canvas-properties-ownership-harness.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'canvas-properties-ownership-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian',
          namespace: 'canvas-properties-ownership',
        }));
        builder.onResolve({ filter: /^\.\.\/core$/u }, () => ({
          path: 'core',
          namespace: 'canvas-properties-ownership',
        }));
        builder.onResolve({ filter: /^\.\.\/logger$/u }, () => ({
          path: 'logger',
          namespace: 'canvas-properties-ownership',
        }));
        builder.onResolve({ filter: /^\.\.\/utils\/tag-utils$/u }, () => ({
          path: 'tag-utils',
          namespace: 'canvas-properties-ownership',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'canvas-properties-ownership' }, (args) => {
          if (args.path === 'obsidian') {
            return {
              loader: 'js',
              contents: `
                export class TFile {
                  constructor(path) {
                    this.path = path;
                    this.name = path.split('/').pop() || '';
                    this.extension = this.name.split('.').pop() || '';
                  }
                }
                export class Notice {}
              `,
            };
          }
          if (args.path === 'core') {
            return {
              loader: 'js',
              contents: `
                export const casefold = (value) => String(value || '').toLocaleLowerCase();
                export const findKeyCaseInsensitive = (record, key) =>
                  Object.keys(record || {}).find((candidate) => casefold(candidate) === casefold(key));
                export const deleteValueCaseInsensitive = (record, key) => {
                  const actual = findKeyCaseInsensitive(record, key);
                  if (actual) delete record[actual];
                };
                export const setValueCaseInsensitive = (record, key, value) => {
                  const actual = findKeyCaseInsensitive(record, key) || key;
                  record[actual] = value;
                };
              `,
            };
          }
          if (args.path === 'logger') {
            return { loader: 'js', contents: 'export const warn = () => {}; export const error = () => {};' };
          }
          return {
            loader: 'js',
            contents: `
              export const normalizeTagList = (value) => Array.isArray(value)
                ? value.map((entry) => String(entry).trim()).filter(Boolean)
                : value == null || String(value).trim() === ''
                  ? []
                  : [String(value).trim()];
            `,
          };
        });
      },
    }],
  });

  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('Canvas bridge uses the current third-party writer without changing its identity', async () => {
  const { CanvasPropertiesService, TFile } = await loadCanvasPropertiesService();
  const file = new TFile('Boards/Plan.canvas');
  let cachedFrontmatter = { title: 'Plan' };
  let persistedFrontmatter = { ...cachedFrontmatter };
  let writerCalls = 0;
  let setTraps = 0;
  let deleteTraps = 0;
  let failNextWrite = false;
  let fileManager;

  const sentinel = async function (targetFile, mutator) {
    assert.equal(this, fileManager);
    assert.equal(targetFile, file);
    writerCalls += 1;
    if (failNextWrite) {
      failNextWrite = false;
      throw new Error('Synthetic Advanced Canvas writer failure');
    }
    const next = { ...cachedFrontmatter };
    await mutator(next);
    cachedFrontmatter = next;
    persistedFrontmatter = { ...next };
    return true;
  };
  const fileManagerTarget = { processFrontMatter: sentinel };
  fileManager = new Proxy(fileManagerTarget, {
    set(target, key, value, receiver) {
      setTraps += 1;
      return Reflect.set(target, key, value, receiver);
    },
    deleteProperty(target, key) {
      deleteTraps += 1;
      return Reflect.deleteProperty(target, key);
    },
  });

  const plugin = {
    app: {
      fileManager,
      metadataCache: {
        getFileCache() {
          return { frontmatter: cachedFrontmatter };
        },
      },
      plugins: {
        enabledPlugins: new Set(['advanced-canvas']),
        plugins: {
          'advanced-canvas': {
            settings: { canvasMetadataCompatibilityEnabled: true },
          },
        },
      },
      vault: {
        async read() {
          return JSON.stringify({
            metadata: {
              version: '1.0-1.0',
              frontmatter: persistedFrontmatter,
            },
          });
        },
        async process() {
          throw new Error('Compatibility fallback should not run after a successful writer call.');
        },
      },
      workspace: { trigger() {} },
    },
    settings: { properties: [] },
    eventService: {
      emitExplicitAction() {},
      emitFilesUpdated() {},
    },
    manifest: { id: 'tps-global-context-menu' },
  };
  const service = new CanvasPropertiesService(plugin);
  const originalIdentity = fileManager.processFrontMatter;

  assert.equal(await service.process(file, (frontmatter) => {
    frontmatter.status = 'active';
  }), true);
  assert.deepEqual(cachedFrontmatter, { status: 'active', title: 'Plan' });
  assert.equal(writerCalls, 1);
  assert.equal(fileManager.processFrontMatter, originalIdentity);
  assert.equal(setTraps, 0);
  assert.equal(deleteTraps, 0);

  assert.equal(await service.process(file, () => {}), false);
  assert.equal(writerCalls, 1);
  assert.equal(fileManager.processFrontMatter, originalIdentity);

  failNextWrite = true;
  await assert.rejects(
    service.process(file, (frontmatter) => {
      frontmatter.status = 'failed';
    }),
    /Synthetic Advanced Canvas writer failure/u,
  );
  assert.equal(fileManager.processFrontMatter, originalIdentity);
  assert.equal(setTraps, 0);
  assert.equal(deleteTraps, 0);
});
