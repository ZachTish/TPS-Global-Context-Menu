import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadCleanupService() {
  const result = await build({
    stdin: {
      contents: [
        "export * from './src/services/daily-note-template-instance-cleanup-service.ts';",
        "export { TFile } from 'obsidian';",
      ].join('\n'),
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      sourcefile: 'daily-note-template-instance-cleanup-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian-stub',
          namespace: 'obsidian-stub',
        }));
        builder.onLoad({ filter: /.*/u, namespace: 'obsidian-stub' }, () => ({
          loader: 'js',
          contents: `
            export class TFile {
              constructor(path) {
                this.path = path;
                this.name = path.split('/').pop() || path;
                this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
                this.basename = this.name.replace(/\\.[^.]+$/u, '');
              }
            }
            export function normalizePath(path) {
              return String(path || '').replace(/\\\\/gu, '/').replace(/\\/{2,}/gu, '/').replace(/^\\//u, '');
            }
            const parseDate = (value, format) => {
              const escaped = String(format || '')
                .replace(/[.*+?^\${}()|[\\]\\\\]/gu, '\\\\$&')
                .replace('YYYY', '(\\\\d{4})')
                .replace('MM', '(\\\\d{2})')
                .replace('DD', '(\\\\d{2})');
              const match = String(value || '').match(new RegExp('^' + escaped + '$', 'u'));
              if (!match) return null;
              const yearIndex = String(format).indexOf('YYYY');
              const monthIndex = String(format).indexOf('MM');
              const dayIndex = String(format).indexOf('DD');
              const slots = [
                { index: yearIndex, name: 'year' },
                { index: monthIndex, name: 'month' },
                { index: dayIndex, name: 'day' },
              ].sort((left, right) => left.index - right.index);
              const values = Object.fromEntries(slots.map((slot, index) => [slot.name, match[index + 1]]));
              const iso = values.year + '-' + values.month + '-' + values.day;
              const date = new Date(iso + 'T00:00:00Z');
              return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
            };
            export function moment(value, format) {
              const iso = parseDate(value, format);
              return {
                isValid: () => Boolean(iso),
                format: (pattern) => {
                  if (!iso) return '';
                  const [year, month, day] = iso.split('-');
                  return String(pattern).replace('YYYY', year).replace('MM', month).replace('DD', day);
                },
              };
            }
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function createHarness(TFile, options = {}) {
  const outputPath = options.outputPath || 'Daily/2026-09-02.md';
  const templatePath = options.templatePath || 'Templates/Daily.md';
  const output = new TFile(outputPath);
  const template = new TFile(templatePath);
  const sources = new Map([
    [output.path, options.outputSource || '---\ntags: [template, keep, template/example]\nkind: dailynote\n---\n#template body\n'],
    [template.path, options.templateSource || '---\ntags: [template, source-only]\n---\nTemplate\n'],
  ]);
  const files = new Map([
    [output.path, output],
    [template.path, template],
  ]);
  const processCalls = [];
  const pending = options.pending || new Set();
  let snapshot = {
    folder: 'Daily',
    format: 'YYYY-MM-DD',
    template: templatePath,
    source: options.source || 'core',
  };
  const vault = {
    getAbstractFileByPath: (path) => files.get(path) || null,
    getFileByPath: (path) => files.get(path) || null,
    read: async (file) => {
      if (!sources.has(file.path)) throw new Error('missing');
      return sources.get(file.path);
    },
    process: async (file, processor) => {
      processCalls.push(file.path);
      options.beforeProcess?.(file, sources);
      sources.set(file.path, processor(sources.get(file.path)));
    },
  };
  const plugin = {
    app: {
      vault,
      metadataCache: {
        getFirstLinkpathDest: (linkpath) => (
          linkpath === templatePath.replace(/\.md$/u, '') ? template : null
        ),
      },
      plugins: {
        getPlugin: (id) => id === 'templater-obsidian'
          ? { templater: { files_with_pending_templates: pending } }
          : null,
      },
    },
    settings: { templateIdentificationTag: 'template' },
    fileNamingService: {
      whenDailyNoteConfigurationReady: async () => {},
      getDailyNoteConfigurationSnapshot: () => ({ ...snapshot }),
    },
  };
  return {
    output,
    template,
    plugin,
    sources,
    files,
    processCalls,
    setSnapshot(next) {
      snapshot = { ...snapshot, ...next };
    },
  };
}

test('configured Daily Note output matching is exact and supports slash date formats', async () => {
  const { getConfiguredDailyNoteOutputPathDate } = await loadCleanupService();
  assert.equal(
    getConfiguredDailyNoteOutputPathDate('Daily/2026-09-02.md', { folder: 'Daily', format: 'YYYY-MM-DD' }),
    '2026-09-02',
  );
  assert.equal(
    getConfiguredDailyNoteOutputPathDate('Daily/2026/09/02.md', { folder: 'Daily', format: 'YYYY/MM/DD' }),
    '2026-09-02',
  );
  assert.equal(
    getConfiguredDailyNoteOutputPathDate('Elsewhere/2026-09-02.md', { folder: 'Daily', format: 'YYYY-MM-DD' }),
    null,
  );
  assert.equal(
    getConfiguredDailyNoteOutputPathDate('Daily/2026-09-02 copy.md', { folder: 'Daily', format: 'YYYY-MM-DD' }),
    null,
  );
});

test('external Daily Note cleanup strips only the exact inherited marker from current bytes', async () => {
  const { DailyNoteTemplateInstanceCleanupService, TFile } = await loadCleanupService();
  const harness = createHarness(TFile, {
    beforeProcess(file, sources) {
      sources.set(
        file.path,
        sources.get(file.path).replace('kind: dailynote', 'kind: dailynote\nconcurrent: retained'),
      );
    },
  });
  const service = new DailyNoteTemplateInstanceCleanupService(harness.plugin, {
    minimumSettleDelayMs: 0,
    stableReadWindowMs: 0,
    pollIntervalMs: 1,
    timeoutMs: 100,
  });

  const result = await service.cleanupCreatedFile(harness.output, Date.now());
  assert.equal(result.status, 'stripped');
  assert.equal(harness.processCalls.length, 1);
  assert.equal(
    harness.sources.get(harness.output.path),
    '---\ntags: [ keep, template/example]\nkind: dailynote\nconcurrent: retained\n---\n#template body\n',
  );
  assert.match(harness.sources.get(harness.template.path), /tags: \[template, source-only\]/u);
});

test('cleanup never strips arbitrary tagged notes or the configured source itself', async () => {
  const { DailyNoteTemplateInstanceCleanupService, TFile } = await loadCleanupService();
  const unrelated = createHarness(TFile, { outputPath: 'Inbox/2026-09-02.md' });
  const unrelatedService = new DailyNoteTemplateInstanceCleanupService(unrelated.plugin, {
    minimumSettleDelayMs: 0,
    stableReadWindowMs: 0,
    pollIntervalMs: 1,
    timeoutMs: 100,
  });
  assert.equal(
    (await unrelatedService.cleanupCreatedFile(unrelated.output)).status,
    'not-configured-output',
  );
  assert.equal(unrelated.processCalls.length, 0);

  const sourceAtOutput = createHarness(TFile, {
    outputPath: 'Daily/2026-09-02.md',
    templatePath: 'Daily/2026-09-02.md',
  });
  const sourceService = new DailyNoteTemplateInstanceCleanupService(sourceAtOutput.plugin, {
    minimumSettleDelayMs: 0,
    stableReadWindowMs: 0,
    pollIntervalMs: 1,
    timeoutMs: 100,
  });
  assert.equal(
    (await sourceService.cleanupCreatedFile(sourceAtOutput.output)).status,
    'configured-template-source',
  );
  assert.equal(sourceAtOutput.processCalls.length, 0);
});

test('cleanup requires current-byte protection on the configured template source', async () => {
  const { DailyNoteTemplateInstanceCleanupService, TFile } = await loadCleanupService();
  const harness = createHarness(TFile, {
    templateSource: '---\ntags: source-only\n---\nTemplate\n',
  });
  const service = new DailyNoteTemplateInstanceCleanupService(harness.plugin, {
    minimumSettleDelayMs: 0,
    stableReadWindowMs: 0,
    pollIntervalMs: 1,
    timeoutMs: 100,
  });
  assert.equal(
    (await service.cleanupCreatedFile(harness.output)).status,
    'configured-template-unprotected',
  );
  assert.equal(harness.processCalls.length, 0);
  assert.match(harness.sources.get(harness.output.path), /tags: \[template,/u);
});

test('cleanup waits for Templater pending work and aborts if configuration changes', async () => {
  const { DailyNoteTemplateInstanceCleanupService, TFile } = await loadCleanupService();
  const pending = new Set(['Daily/2026-09-02.md']);
  const harness = createHarness(TFile, { pending });
  const service = new DailyNoteTemplateInstanceCleanupService(harness.plugin, {
    minimumSettleDelayMs: 0,
    stableReadWindowMs: 2,
    pollIntervalMs: 1,
    timeoutMs: 100,
  });
  globalThis.setTimeout(() => pending.clear(), 8);
  const result = await service.cleanupCreatedFile(harness.output);
  assert.equal(result.status, 'stripped');
  assert.equal(harness.processCalls.length, 1);

  const changed = createHarness(TFile);
  const changedService = new DailyNoteTemplateInstanceCleanupService(changed.plugin, {
    minimumSettleDelayMs: 12,
    stableReadWindowMs: 1,
    pollIntervalMs: 1,
    timeoutMs: 100,
  });
  globalThis.setTimeout(() => changed.setSnapshot({ folder: 'Other Daily' }), 4);
  assert.equal(
    (await changedService.cleanupCreatedFile(changed.output)).status,
    'configuration-changed',
  );
  assert.equal(changed.processCalls.length, 0);
});

test('created-file writers are gated behind template cleanup and replay afterward', () => {
  const source = readFileSync(new URL('../src/events/register-events.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /dailyNoteTemplateInstanceCleanup\.schedule\(file,[\s\S]{0,520}result\.status === 'stripped'[\s\S]{0,260}scheduleCreatedFileAutomation\(liveFile\)/u,
  );
  assert.match(
    source,
    /scheduleCreatedFileAutomation[\s\S]{0,500}notebookNavigatorRuleService\.scheduleApply[\s\S]{0,1200}syncTitleFromFilename[\s\S]{0,600}syncFileTimestamps/u,
  );
});
