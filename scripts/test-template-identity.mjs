import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function importHarness() {
  const result = await build({
    stdin: {
      contents: `
        export { TemplateIdentityService } from './src/services/template-identity-service.ts';
        export { TFile } from 'obsidian';
      `,
      resolveDir: repoRoot,
      sourcefile: 'template-identity-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(context) {
        context.onResolve({ filter: /^obsidian$/u }, () => ({ path: 'obsidian', namespace: 'test' }));
        context.onLoad({ filter: /.*/u, namespace: 'test' }, () => ({
          loader: 'js',
          contents: `
            export class TFile {
              constructor(path) {
                this.path = path;
                this.name = path.split('/').pop();
                this.basename = this.name.replace(/\\.[^.]+$/u, '');
                this.extension = this.name.split('.').pop();
              }
            }
            export const normalizePath = value => String(value ?? '').replace(/\\\\/gu, '/').replace(/^\\/+|\\/+$/gu, '');
            export const getAllTags = cache => cache?.tags ?? [];
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function createPlugin(TFile, settings, records, tags = {}, templaterFolder = 'Templates') {
  const files = Object.keys(records).map(path => new TFile(path));
  const byPath = new Map(files.map(file => [file.path, file]));
  return {
    settings,
    app: {
      vault: { getMarkdownFiles: () => files },
      metadataCache: {
        getFileCache: file => ({ frontmatter: records[file.path], tags: tags[file.path] ?? [] }),
      },
      plugins: {
        getPlugin: id => id === 'templater-obsidian' ? { settings: { templates_folder: templaterFolder } } : null,
      },
    },
    byPath,
  };
}

test('template identity supports folder, tag, and property rules without moving files', async () => {
  const { TemplateIdentityService, TFile } = await importHarness();
  const records = {
    'Templates/Legacy.md': { title: 'Legacy' },
    'Daily Note Template.md': { title: '<% moment(tp.file.title).format("YYYY-MM-DD") %>' },
    'Tagged.md': { title: 'Tagged' },
    'Ordinary.md': { title: 'Ordinary' },
  };
  const settings = {
    templateIdentificationMode: 'templater-folder',
    templateIdentificationTag: 'tps-template',
    templateIdentificationPropertyKey: 'title',
    templateIdentificationPropertyValue: '<%',
    templateIdentificationPropertyMatch: 'contains',
  };
  const plugin = createPlugin(TFile, settings, records, { 'Tagged.md': ['#TPS-Template'] });
  const service = new TemplateIdentityService(plugin);

  assert.deepEqual(service.list().map(file => file.path), ['Templates/Legacy.md']);

  settings.templateIdentificationMode = 'tag';
  assert.deepEqual(service.list().map(file => file.path), ['Tagged.md']);

  settings.templateIdentificationMode = 'property';
  assert.deepEqual(service.list().map(file => file.path), ['Daily Note Template.md']);
  assert.equal(service.matches(plugin.byPath.get('Ordinary.md')), false);
});

test('property equality compares scalar and list values case-insensitively', async () => {
  const { TemplateIdentityService, TFile } = await importHarness();
  const settings = {
    templateIdentificationMode: 'property',
    templateIdentificationTag: '',
    templateIdentificationPropertyKey: 'TPS Template',
    templateIdentificationPropertyValue: 'yes',
    templateIdentificationPropertyMatch: 'equals',
  };
  const plugin = createPlugin(TFile, settings, {
    'Scalar.md': { 'tps template': 'YES' },
    'List.md': { 'TPS TEMPLATE': ['no', 'Yes'] },
    'Wrong.md': { 'tps template': 'yesterday' },
  });
  const service = new TemplateIdentityService(plugin);
  assert.deepEqual(service.list().map(file => file.path), ['List.md', 'Scalar.md']);
});
