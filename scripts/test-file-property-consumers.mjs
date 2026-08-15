import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadVaultQueryModule() {
  const result = await build({
    stdin: {
      contents: `
        export { VaultQueryService } from './src/services/vault-query-service.ts';
        export { App, TFile } from 'obsidian';
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      sourcefile: 'file-property-query-test-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'file-property-query-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'test-double' }));
        builder.onResolve({ filter: /core\/operation-batch-utils$/u }, () => ({ path: 'batch', namespace: 'test-double' }));
        builder.onResolve({ filter: /logger$/u }, () => ({ path: 'logger', namespace: 'test-double' }));
        builder.onLoad({ filter: /^obsidian$/u, namespace: 'test-double' }, () => ({
          loader: 'js',
          contents: `
            export class App {}
            export class TFile {
              constructor(path) {
                this.path = path;
                this.name = path.split('/').pop();
                this.extension = this.name.includes('.') ? this.name.split('.').pop().toLowerCase() : '';
                this.basename = this.name.replace(/\\.[^.]+$/u, '');
                this.stat = { ctime: 1, mtime: 1, size: 0 };
              }
            }
          `,
        }));
        builder.onLoad({ filter: /^batch$/u, namespace: 'test-double' }, () => ({
          loader: 'js',
          contents: 'export const runInBatches = async (items, callback) => { for (const item of items) await callback(item); };',
        }));
        builder.onLoad({ filter: /^logger$/u, namespace: 'test-double' }, () => ({
          loader: 'js',
          contents: 'export const log = () => {}; export const warn = () => {};',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

test('vault queries include generic assets only when requested and never expose companion notes', async () => {
  const { App, TFile, VaultQueryService } = await loadVaultQueryModule();
  const app = new App();
  const files = [
    new TFile('Notes/Project.md'),
    new TFile('Maps/System.canvas'),
    new TFile('Views/Projects.base'),
    new TFile('Reference/Guide.pdf'),
    new TFile('Media/Preview.png'),
    new TFile('Data/Export.bin'),
    new TFile('_assets/TPS File Properties/Media/Preview.png.md'),
  ];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const properties = new Map([
    ['Maps/System.canvas', { kind: 'map', tags: ['native-record'] }],
    ['Views/Projects.base', { kind: 'view' }],
    ['Reference/Guide.pdf', { kind: 'reference' }],
    ['Media/Preview.png', { kind: 'image' }],
    ['Data/Export.bin', { kind: 'data' }],
  ]);
  app.vault = {
    getFiles: () => files,
    getMarkdownFiles: () => files.filter((file) => file.extension === 'md'),
    getAbstractFileByPath: (path) => byPath.get(path) ?? null,
  };
  app.metadataCache = {
    getFileCache: (file) => {
      if (file.path === 'Maps/System.canvas') return { tags: [{ tag: '#legacy-canvas-cache' }] };
      return file.extension === 'md' && !file.path.startsWith('_assets/')
        ? { frontmatter: { kind: 'note' } }
        : null;
    },
  };
  const plugin = {
    app,
    filePropertiesService: {
      isCompanionFile: (file) => file.path.startsWith('_assets/TPS File Properties/'),
      isPropertyTarget: (file) => file.extension !== 'md' && !file.path.startsWith('_assets/'),
      read: (file) => properties.get(file.path) ?? {},
      getFrontmatterAsync: async (file) => properties.get(file.path) ?? {},
    },
  };
  const service = new VaultQueryService(plugin);

  assert.deepEqual(service.query().map((result) => result.file.path), ['Notes/Project.md']);
  assert.deepEqual(
    service.query({ includeCanvasFiles: true }).map((result) => result.file.path),
    ['Notes/Project.md', 'Maps/System.canvas'],
  );
  assert.deepEqual(
    service.query({ includeNonMarkdownFiles: true }).map((result) => result.file.path),
    files.slice(0, -1).map((file) => file.path),
  );
  assert.deepEqual(
    (await service.queryAsync({ includeNonMarkdownFiles: true })).map((result) => result.file.path),
    files.slice(0, -1).map((file) => file.path),
  );
  assert.deepEqual(
    service.query({
      includeNonMarkdownFiles: true,
      properties: [{ key: 'kind', operator: 'equals', value: 'reference' }],
    }).map((result) => result.file.path),
    ['Reference/Guide.pdf'],
  );
  assert.deepEqual(
    service.query({ includeCanvasFiles: true, tags: { include: ['native-record'] } })
      .map((result) => result.file.path),
    ['Maps/System.canvas'],
  );
  assert.equal(service.getFile('_assets/TPS File Properties/Media/Preview.png.md'), null);
  assert.deepEqual(service.getFile('Media/Preview.png')?.frontmatter, { kind: 'image' });
});

test('property consumers route generic files through the native store and guard background writes', () => {
  const mutation = read('src/services/frontmatter-mutation-service.ts');
  const nativeStore = read('src/services/file-properties-service.ts');
  const bulkEdit = read('src/services/bulk-edit-service.ts');
  const controller = read('src/menu/menu-controller.ts');
  const builder = read('src/menu/menu-builder.ts');
  const badges = read('src/menu/badge-renderer.ts');
  const rows = read('src/services/property-row-service.ts');
  const contextTargets = read('src/services/context-target-service.ts');
  const rules = read('src/services/notebook-navigator-rule-service.ts');
  const query = read('src/services/vault-query-service.ts');
  const api = read('src/plugin-api.ts');

  for (const source of [mutation, bulkEdit, controller, builder, badges, rows, contextTargets, rules, query]) {
    assert.doesNotMatch(source, /canvasPropertiesService/u);
  }
  assert.match(mutation, /filePropertiesService\.process\(file, mutator, cause\)/u);
  assert.match(mutation, /filePropertiesService\?\.setListValues\(nonMarkdownFiles, key, values, cause\)/u);
  assert.match(mutation, /filePropertiesService\?\.deleteKeys\(nonMarkdownFiles, normalizedKeys, cause\)/u);
  assert.match(rules, /kind:\s*'automation'[\s\S]{0,160}surface:\s*'notebook-navigator-rules'/u);
  assert.match(mutation, /emitFilesUpdated\(\[file\.path\], \{ sourcePluginId \}\)/u);
  assert.match(mutation, /if \(cause\.kind !== 'automation'\) \{[\s\S]{0,180}emitExplicitAction/u);
  assert.match(api, /const publicMutationCause[\s\S]{0,300}kind:\s*'automation'[\s\S]{0,120}surface:\s*'plugin-api'/u);
  assert.match(api, /frontmatterMutationService\.process\(file, mutator, publicMutationCause\(cause\)\)/u);
  assert.match(api, /filePropertiesService\.process\(file, mutator, publicMutationCause\(cause\)\)/u);
  assert.match(nativeStore, /const normalized = this\.sortUserProperties\(this\.sanitizeUserProperties\(next\)\);/u);
  assert.match(nativeStore, /if \(!key \|\| key === 'position' \|\| this\.isReservedKey\(key\)\) continue;/u);
  assert.match(nativeStore, /casefold\(key\) === 'tags'[\s\S]{0,100}normalizeTagList\(value\)/u);
  assert.match(bulkEdit, /const isMarkdown = file\.extension\?\.toLowerCase\(\) === 'md';/u);
  assert.match(bulkEdit, /if \(isMarkdown\) \{[\s\S]{0,220}removeInlineTagsSafely/u);
  assert.match(contextTargets, /getSourceFileForCompanion\(file\)/u);
  assert.match(contextTargets, /hasUnresolvedExplicitCompanion/u);
  assert.match(contextTargets, /explicit-unresolved-companion/u);
  assert.equal((contextTargets.match(/filePropertiesService\?\.isCompanionFile\(file\)/gu) || []).length >= 3, true);
  assert.doesNotMatch(controller, /extensions:\s*\['md', 'canvas'\]/u);
  assert.match(controller, /filter: \(file\) => !this\.plugin\.filePropertiesService\?\.isCompanionFile\(file\)/u);
  assert.match(rules, /filePropertiesService\?\.hasCompanion\(file\) === true/u);
  assert.match(rules, /if \(file\.extension\?\.toLowerCase\(\) !== 'md'\) return '';/u);
  assert.match(query, /includeNonMarkdownFiles\?: boolean/u);
  assert.match(query, /includeCanvasFiles\?: boolean/u);
});

test('managed companions stay out of note, task, recurrence, and picker workflows', () => {
  const taskCheckbox = read('src/handlers/task-checkbox-handler.ts');
  const bulkEdit = read('src/services/bulk-edit-service.ts');
  const filePicker = read('src/modals/FileSuggestModal.ts');
  const multiPicker = read('src/modals/MultiFileSelectModal.ts');
  const homeCapture = read('src/services/home-capture-service.ts');
  const headingSuggest = read('src/services/heading-link-suggest.ts');
  const timeTracking = read('src/services/time-tracking-service.ts');
  const taskApi = read('src/services/task-api-service.ts');
  const dailyInbox = read('src/services/daily-inbox-line-service.ts');
  const persistentMenus = read('src/menu/persistent-menu-manager.ts');
  const panelBuilder = read('src/menu/panel-builder.ts');
  const tpsList = read('src/tps-list/views/TpsListView.ts');
  const tpsTable = read('src/views/log-base-view.ts');

  assert.match(taskCheckbox, /synchronizeChecklistPropertyForAllMarkdownFiles[\s\S]{0,500}isCompanionFile/u);
  assert.match(taskCheckbox, /updateChecklistPropertyForFile[\s\S]{0,250}isCompanionFile/u);
  assert.match(bulkEdit, /checkMissingRecurrences[\s\S]{0,400}getMarkdownFiles\(\)[\s\S]{0,200}isCompanionFile/u);
  assert.match(bulkEdit, /createNextRecurrenceInstance[\s\S]{0,250}isCompanionFile/u);
  assert.match(bulkEdit, /applyTemplateToOpenInstances[\s\S]{0,250}isCompanionFile/u);
  assert.match(bulkEdit, /runDeletedLinkCleanup[\s\S]{0,800}getRelationshipCandidates\(\{ includeIgnored: true \}\)[\s\S]{0,200}isCompanionFile/u);
  assert.match(bulkEdit, /getLogicalFrontmatter\(file\)/u);
  assert.match(bulkEdit, /if \(file\.extension\?\.toLowerCase\(\) !== 'md'\)/u);
  for (const picker of [filePicker, multiPicker]) {
    assert.match(picker, /isFilePropertiesCompanionPath/u);
    assert.match(picker, /isFilePropertiesCompanionRecord/u);
  }
  for (const source of [homeCapture, headingSuggest, timeTracking, taskApi, dailyInbox, persistentMenus, panelBuilder, tpsList, tpsTable]) {
    assert.match(source, /filePropertiesService\?\.isCompanionFile/u);
  }
});
