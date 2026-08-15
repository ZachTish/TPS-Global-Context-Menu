import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Advanced Canvas property storage is removed in favor of the native companion store', () => {
  const service = read('src/services/file-properties-service.ts');
  const main = read('src/main.ts');
  const events = read('src/events/register-events.ts');
  const menuPatch = read('src/menu/menu-patcher.ts');

  assert.match(service, /_assets\/TPS File Properties/u);
  assert.match(service, /class FilePropertiesService/u);
  assert.doesNotMatch(service, /advanced-canvas|canvasMetadataCompatibilityEnabled/u);
  assert.doesNotMatch(main, /CanvasPropertiesService/u);
  assert.doesNotMatch(events, /canvas:node-menu/u);
  assert.match(menuPatch, /injectNativeCanvasTarget/u);
  assert.match(menuPatch, /resolveCanvasTarget\(event\)/u);
});

test('generic file properties keep the Canvas API and query options backward compatible', () => {
  const api = read('src/plugin-api.ts');
  const query = read('src/services/vault-query-service.ts');
  const contracts = read('src/tps-contracts.ts');

  assert.match(api, /fileProperties:\s*filePropertiesApi/u);
  assert.match(api, /canvasProperties:\s*canvasPropertiesApi/u);
  assert.match(api, /const canvasPropertiesApi = \{[\s\S]*plugin\.filePropertiesService\.readCanvasCompatibility/u);
  assert.match(query, /includeCanvasFiles\?: boolean/u);
  assert.match(query, /includeNonMarkdownFiles\?: boolean/u);
  assert.match(contracts, /GCM_FILE_PROPERTIES_UPDATED:\s*["']tps:gcm-file-properties-updated["']/u);
});

test('legacy Canvas JSON is read only and imported into the companion on first write', () => {
  const service = read('src/services/file-properties-service.ts');

  assert.match(service, /readLegacyCanvasFrontmatter/u);
  assert.match(service, /metadata[\s\S]*frontmatter/u);
  assert.match(service, /mergeMissingProperties/u);
  assert.match(service, /tpsGcmImportedCanvasAt/u);
  assert.doesNotMatch(service, /vault\.modify\(file|vault\.process\(file/u);
});

test('note-to-Canvas conversion stores copied properties in a companion, not Canvas JSON', () => {
  const operations = read('src/services/note-operation-service.ts');
  const api = read('src/plugin-api.ts');

  assert.match(operations, /const document = this\.buildCanvasDocument\(nodeText\)/u);
  assert.match(operations, /filePropertiesService\.initializeForConversion\(created, frontmatter\)/u);
  assert.doesNotMatch(operations, /metadata:\s*\{\s*version:[\s\S]*frontmatter/u);
  assert.match(api, /convertNotesToCanvases/u);
  assert.match(api, /copy properties into a native companion note/u);
});

test('all non-Markdown file types can use native property menus while note-only actions stay scoped', () => {
  const menu = read('src/menu/menu-builder.ts');
  const context = read('src/services/context-target-service.ts');
  const rules = read('src/services/notebook-navigator-rule-service.ts');

  assert.match(menu, /filePropertiesService\?\.isPropertyTarget\(file\)/u);
  assert.match(menu, /Create file properties note/u);
  assert.match(context, /getSourceFileForCompanion/u);
  assert.match(rules, /canUseExistingPropertyStorage/u);
  assert.match(rules, /file\.extension\?\.toLowerCase\(\) !== 'md'\) return ''/u);
});
