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

function createPlugin(TFile, settings, records, tags = {}, templaterFolder = 'Templates', sources = {}) {
  const files = Object.keys(records).map(path => new TFile(path));
  const byPath = new Map(files.map(file => [file.path, file]));
  return {
    settings,
    app: {
      vault: {
        getMarkdownFiles: () => files,
        read: async file => {
          if (Object.hasOwn(sources, file.path)) return sources[file.path];
          throw new Error(`Unreadable fixture: ${file.path}`);
        },
      },
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
    'Tagged.md': { title: 'Tagged', tags: ['#TPS-Template'] },
    'BodyTagOnly.md': { title: 'Body tag only' },
    'Ordinary.md': { title: 'Ordinary' },
  };
  const settings = {
    templateIdentificationMode: 'templater-folder',
    templateIdentificationTag: 'tps-template',
    templateIdentificationPropertyKey: 'title',
    templateIdentificationPropertyValue: '<%',
    templateIdentificationPropertyMatch: 'contains',
  };
  const plugin = createPlugin(TFile, settings, records, {
    'BodyTagOnly.md': ['#TPS-Template'],
    'Tagged.md': ['#TPS-Template'],
  });
  const service = new TemplateIdentityService(plugin);

  assert.deepEqual(service.list().map(file => file.path), ['Templates/Legacy.md']);

  settings.templateIdentificationMode = 'tag';
  assert.deepEqual(service.list().map(file => file.path), ['Tagged.md']);
  assert.equal(service.matches(plugin.byPath.get('BodyTagOnly.md')), false, 'body tags do not identify template sources');

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

test('an empty or unavailable Templater folder never classifies the whole vault as templates', async () => {
  const { TemplateIdentityService, TFile } = await importHarness();
  const settings = {
    templateIdentificationMode: 'templater-folder',
    templateIdentificationTag: 'template',
    templateIdentificationPropertyKey: '',
    templateIdentificationPropertyValue: '',
    templateIdentificationPropertyMatch: 'equals',
  };
  const plugin = createPlugin(TFile, settings, {
    'Daily.md': { title: 'Daily' },
    'Templates/Actual.md': { title: 'Actual' },
  }, {}, '');
  const service = new TemplateIdentityService(plugin);

  assert.deepEqual(service.list(), []);
  settings.templateIdentificationMode = undefined;
  assert.equal(service.getMode(), 'tag', 'missing saved mode uses the safe Tag default');
});

test('template mutation capabilities check current tag bytes and fail closed when they cannot be read', async () => {
  const { TemplateIdentityService, TFile } = await importHarness();
  const settings = {
    templateIdentificationMode: 'tag',
    templateIdentificationTag: 'template',
  };
  const plugin = createPlugin(
    TFile,
    settings,
    {
      'Protected.md': { tags: ['template'] },
      'Ordinary.md': {},
      'Unreadable.md': {},
    },
    {},
    'Templates',
    {
      'Protected.md': '---\ntags: [template]\n---\nProtected\n',
      'Ordinary.md': '---\ntags: [ordinary]\n---\nOrdinary\n',
    },
  );
  const service = new TemplateIdentityService(plugin);

  assert.equal(service.version, 1, 'additive mutation capabilities preserve the public v1 identity contract');
  assert.equal(await service.canAutomaticallyMutate(plugin.byPath.get('Protected.md')), false);
  assert.equal(await service.canAutomaticallyMutate(plugin.byPath.get('Ordinary.md')), true);
  assert.equal(await service.canAutomaticallyMutate(plugin.byPath.get('Unreadable.md')), false);
  assert.equal(service.canAutomaticallyMutateSource('---\ntags: [template]\n---\n'), false);
  assert.equal(service.canAutomaticallyMutateSource('---\ntags: [ordinary]\n---\n'), true);
  assert.equal(service.canAutomaticallyMutateFrontmatter({ tags: ['template'] }), false);
  assert.equal(service.canAutomaticallyMutateFrontmatter({ tags: ['ordinary'] }), true);
  assert.equal(
    service.prepareInstanceSource('---\ntags: [template, keep]\n---\n#template\n'),
    '---\ntags: [ keep]\n---\n#template\n',
    'instance preparation removes only the exact identity marker',
  );
  assert.equal(
    service.prepareInstanceSource('---\ntags: [template\n---\n'),
    null,
    'ambiguous source bytes fail closed',
  );
});
