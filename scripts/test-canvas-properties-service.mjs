import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('canvas properties bridge delegates to Advanced Canvas metadata compatibility', () => {
  const service = read('src/services/canvas-properties-service.ts');
  const main = read('src/main.ts');
  assert.match(service, /Bridges GCM canvas property reads\/writes to Advanced Canvas/);
  assert.match(service, /getFileCache\(file\)\?\.frontmatter/);
  assert.match(service, /resolveFrontmatterWriter/);
  assert.match(service, /current\.call\(fileManager, file, mutator\)/);
  assert.match(service, /canvasMetadataCompatibilityEnabled/);
  assert.doesNotMatch(service, /readCanvasDocument/);
  assert.match(service, /Advanced Canvas bridge did not persist canvas metadata; applying compatibility fallback/);
  assert.match(service, /writeCanvasMetadataCompatibilityFallback/);
  assert.match(service, /metadata\.frontmatter = \{ \.\.\.frontmatter \}/);
  assert.match(service, /if \(!\(await this\.waitForCanvasMetadata\(file, sorted\)\)\)/);
  assert.doesNotMatch(main, /nativeProcessFrontmatterDelegate/);
  assert.doesNotMatch(main, /__tpsGcmFrontmatterPatch/);
  assert.doesNotMatch(main, /installProcessFrontmatterPatch/);
  assert.match(service, /tps:gcm-canvas-properties-updated/);
});

test('frontmatter mutation service routes canvas files through canvas properties', () => {
  const service = read('src/services/frontmatter-mutation-service.ts');
  const bulkEdit = read('src/services/bulk-edit-service.ts');
  assert.match(service, /canvasPropertiesService\?\.isCanvasFile\(file\)/);
  assert.match(service, /canvasPropertiesService\?\.updateValues\(canvasFiles, updates\)/);
  assert.match(service, /canvasPropertiesService\?\.setListValues\(canvasFiles, key, values\)/);
  assert.match(service, /canvasPropertiesService\?\.deleteKeys\(canvasFiles, normalizedKeys\)/);
  assert.match(bulkEdit, /extension !== 'md' && !this\.plugin\.canvasPropertiesService\?\.isCanvasFile\(file\)/);
  assert.match(bulkEdit, /extension === 'md' && !\(await this\.canMutateFrontmatterSafely\(file\)\)/);
});

test('notebook navigator rules can write icon properties to canvas files', () => {
  const service = read('src/services/notebook-navigator-rule-service.ts');
  const events = read('src/events/register-events.ts');
  const main = read('src/main.ts');
  const api = read('src/plugin-api.ts');

  assert.match(service, /canApplyToFile\(file: unknown\): file is TFile/);
  assert.match(service, /extension === 'md' \|\| extension === 'canvas'/);
  assert.match(service, /this\.plugin\.app\.vault\.getFiles\(\)\.filter\(\(file\): file is TFile => this\.canApplyToFile\(file\)\)/);
  assert.match(service, /this\.plugin\.frontmatterMutationService\.process\(file, \(frontmatter\) =>/);
  assert.match(service, /canvasPropertiesService\.read\(file\)/);
  assert.doesNotMatch(service, /applyRulesToFile\(file: TFile[\s\S]{0,120}file\.extension !== 'md'/);
  assert.match(events, /notebookNavigatorRuleService\.scheduleApply\(file,\s*\{\s*reason: 'create'/);
  assert.match(events, /notebookNavigatorRuleService\.scheduleApply\(liveFile,\s*\{\s*reason: 'rename'/);
  assert.match(main, /No active markdown or canvas file/);
  assert.match(api, /notebookNavigatorRuleService\.canApplyToFile\(file\)/);
});

test('vault query API can opt into canvas files asynchronously', () => {
  const service = read('src/services/vault-query-service.ts');
  const api = read('src/plugin-api.ts');
  assert.match(service, /includeCanvasFiles\?: boolean/);
  assert.match(service, /extension === 'md' \|\| extension === 'canvas'/);
  assert.match(service, /count\(criteria: VaultQueryCriteria = \{\}\): number \{\s*const files = this\.getCandidateFiles\(criteria\);/);
  assert.match(service, /canvasPropertiesService\.read\(file\)/);
  assert.match(api, /canvasProperties: canvasPropertiesApi/);
  assert.match(api, /getFileAsync/);
});

test('native GCM property menus include canvas files but keep note conversion markdown-only', () => {
  const menu = read('src/menu/menu-builder.ts');
  const controller = read('src/menu/menu-controller.ts');
  const contextTargets = read('src/services/context-target-service.ts');
  assert.match(menu, /extension === 'md' \|\| extension === 'canvas'/);
  assert.match(menu, /const propertyEntries = entries\.filter\(\(entry\) => this\.isPropertyFile\(entry\.file\)\)/);
  assert.match(menu, /resolveCustomProperties\(this\.plugin\.settings\.properties \|\| \[\], propertyEntries/);
  assert.match(menu, /convertNotesToCanvases\(markdownFiles\)/);
  assert.match(controller, /extension === 'md' \|\| extension === 'canvas'/);
  assert.match(contextTargets, /extension === 'md' \|\| extension === 'canvas'/);
  assert.match(contextTargets, /\$\{raw\}\.canvas/);
});

test('async vault queries can filter canvas files by node content', () => {
  const service = read('src/services/vault-query-service.ts');
  assert.match(service, /export interface ContentQueryFilter/);
  assert.match(service, /content\?: ContentQueryFilter/);
  assert.match(service, /matchesContentFilterAsync\(file, criteria\.content\)/);
  assert.match(service, /JSON\.parse\(content \|\| '\{\}'\)/);
  assert.match(service, /getCanvasNodeSearchText\(parsed, filter\.canvasNodeTypes\)/);
  assert.match(service, /type === 'text'[\s\S]*record\.text/);
  assert.match(service, /type === 'file'[\s\S]*record\.file[\s\S]*record\.subpath/);
  assert.match(service, /type === 'group'[\s\S]*record\.label/);
  assert.match(service, /type === 'link'[\s\S]*record\.url/);
  assert.match(service, /if \(criteria\.content && !options\.allowContentRead\) return null/);
});

test('note to canvas conversion copies frontmatter into Advanced Canvas metadata', () => {
  const service = read('src/services/note-operation-service.ts');
  const api = read('src/plugin-api.ts');
  const menu = read('src/menu/menu-builder.ts');
  assert.match(service, /async convertNotesToCanvases\(files: TFile\[\], options: NoteToCanvasOptions = \{\}\): Promise<TFile\[\]>/);
  assert.match(service, /async createCanvasFromNote\(file: TFile, options: NoteToCanvasOptions = \{\}\): Promise<TFile \| null>/);
  assert.match(service, /const frontmatter = this\.cloneFrontmatterObject\(parts\.frontmatter \|\| \{\}\)/);
  assert.match(service, /metadata:\s*\{\s*version: "1\.0-1\.0",\s*frontmatter,/);
  assert.match(service, /type: "text"[\s\S]*text,/);
  assert.match(service, /this\.app\.vault\.create\(targetPath, `\$\{JSON\.stringify\(document, null, 2\)\}\\n`\)/);
  assert.doesNotMatch(service, /archiveSourceNotes\(createdFiles/);
  assert.match(api, /convertNotesToCanvases/);
  assert.match(api, /createCanvasFromNote/);
  assert.match(menu, /Convert to canvas/);
  assert.match(menu, /convertNotesToCanvases\(markdownFiles\)/);
});
