import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    stdin: {
      contents: `
        export * from './src/services/tps-base-write-target-service.ts';
        export { TFile } from 'obsidian';
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      sourcefile: 'tps-base-write-target-test-entry.ts',
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
        builder.onResolve({ filter: /^obsidian$/ }, () => ({
          path: 'obsidian',
          namespace: 'tps-base-write-target-test',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'tps-base-write-target-test' }, () => ({
          contents: `
            class TFile {
              constructor(path, extension) {
                this.path = path;
                this.extension = extension ?? String(path).split('.').pop();
              }
            }
            module.exports = {
              TFile,
              normalizePath(value) {
                return String(value)
                  .replace(/\\\\/gu, '/')
                  .replace(/\\/+/gu, '/')
                  .replace(/^\\.\\//u, '');
              },
            };
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function createHost(TFile, {
  fallbackMode = 'filter-required',
  fallbackPath = '',
  entries = [],
  dailyNote = null,
} = {}) {
  const files = new Map(entries);
  const createdFolders = [];
  const createdFiles = [];
  const dailyCalls = [];
  const vault = {
    getAbstractFileByPath(path) {
      return files.get(path) ?? null;
    },
    async createFolder(path) {
      const folder = { path, children: [] };
      files.set(path, folder);
      createdFolders.push(path);
      return folder;
    },
    async create(path, content) {
      const file = new TFile(path);
      files.set(path, file);
      createdFiles.push({ path, content });
      return file;
    },
  };
  return {
    host: {
      app: { vault },
      settings: {
        tpsBaseWriteFallbackMode: fallbackMode,
        tpsBaseWriteFallbackPath: fallbackPath,
      },
      noteOperationService: {
        async ensureDailyNote(value) {
          dailyCalls.push(value);
          return dailyNote;
        },
      },
    },
    files,
    createdFolders,
    createdFiles,
    dailyCalls,
  };
}

test('write-target setting and note-path normalization is stable', async () => {
  const {
    normalizeTpsBaseWriteFallbackMode,
    normalizeTpsBaseWriteNotePath,
  } = await loadModule();

  assert.equal(normalizeTpsBaseWriteFallbackMode('today-daily-note'), 'today-daily-note');
  assert.equal(normalizeTpsBaseWriteFallbackMode('specific-note'), 'specific-note');
  assert.equal(normalizeTpsBaseWriteFallbackMode('filter-required'), 'filter-required');
  assert.equal(normalizeTpsBaseWriteFallbackMode('unknown'), 'today-daily-note');
  assert.equal(normalizeTpsBaseWriteFallbackMode(null), 'today-daily-note');

  assert.equal(normalizeTpsBaseWriteNotePath(' [[Projects/Tasks|Task sink]] '), 'Projects/Tasks.md');
  assert.equal(normalizeTpsBaseWriteNotePath('[Task sink](Inbox/Capture.md#Tasks)'), 'Inbox/Capture.md');
  assert.equal(normalizeTpsBaseWriteNotePath('"/Inbox/Task Note"'), 'Inbox/Task Note.md');
  assert.equal(normalizeTpsBaseWriteNotePath('Resources/Board.canvas'), 'Resources/Board.canvas');
  assert.equal(normalizeTpsBaseWriteNotePath(''), null);
});

test('an explicit filter target wins over every configured fallback', async () => {
  const { resolveTpsBaseWriteTarget, TFile } = await loadModule();
  const explicitFile = new TFile('Projects/Explicit.md');
  const dailyFile = new TFile('Daily/2026-07-24.md');
  const { host, dailyCalls } = createHost(TFile, {
    fallbackMode: 'today-daily-note',
    entries: [['Projects/Explicit.md', explicitFile]],
    dailyNote: dailyFile,
  });

  const result = await resolveTpsBaseWriteTarget(host, {
    explicitTargetPath: 'Projects/Explicit',
    explicitTargetSpecified: true,
    createExplicitIfMissing: false,
    todayIsoDate: () => '2026-07-24',
  });

  assert.deepEqual(
    { file: result.file, source: result.source, path: result.path, reason: result.reason },
    { file: explicitFile, source: 'filter', path: explicitFile.path, reason: 'resolved' },
  );
  assert.deepEqual(dailyCalls, []);
});

test('today Daily Note fallback resolves only when no filter target was specified', async () => {
  const { resolveTpsBaseWriteTarget, TFile } = await loadModule();
  const dailyFile = new TFile('Daily/2026-07-24.md');
  const { host, dailyCalls } = createHost(TFile, {
    fallbackMode: 'today-daily-note',
    dailyNote: dailyFile,
  });

  const result = await resolveTpsBaseWriteTarget(host, {
    todayIsoDate: () => '2026-07-24',
  });

  assert.equal(result.file, dailyFile);
  assert.equal(result.source, 'today-daily-note');
  assert.equal(result.path, dailyFile.path);
  assert.equal(result.reason, 'resolved');
  assert.deepEqual(dailyCalls, ['2026-07-24 00:00:00']);
});

test('an unset write-target setting defaults to today while explicit conservative modes remain intact', async () => {
  const { resolveTpsBaseWriteTarget, TFile } = await loadModule();
  const dailyFile = new TFile('Daily/2026-07-24.md');
  const { host, dailyCalls } = createHost(TFile, {
    fallbackMode: 'today-daily-note',
    dailyNote: dailyFile,
  });
  delete host.settings.tpsBaseWriteFallbackMode;

  const result = await resolveTpsBaseWriteTarget(host, {
    todayIsoDate: () => '2026-07-24',
  });

  assert.equal(result.file, dailyFile);
  assert.equal(result.source, 'today-daily-note');
  assert.deepEqual(dailyCalls, ['2026-07-24 00:00:00']);

  host.settings.tpsBaseWriteFallbackMode = 'filter-required';
  assert.equal((await resolveTpsBaseWriteTarget(host, { todayIsoDate: () => '2026-07-24' })).reason, 'filter-required');
});

test('specific-note fallback resolves an existing Markdown note without creating it', async () => {
  const { resolveTpsBaseWriteTarget, TFile } = await loadModule();
  const fallbackFile = new TFile('Projects/Tasks.md');
  const { host, createdFiles, dailyCalls } = createHost(TFile, {
    fallbackMode: 'specific-note',
    fallbackPath: '[[Projects/Tasks|Task inbox]]',
    entries: [['Projects/Tasks.md', fallbackFile]],
  });

  const result = await resolveTpsBaseWriteTarget(host, {
    todayIsoDate: () => '2026-07-24',
  });

  assert.equal(result.file, fallbackFile);
  assert.equal(result.source, 'specific-note');
  assert.equal(result.path, fallbackFile.path);
  assert.equal(result.reason, 'resolved');
  assert.deepEqual(createdFiles, []);
  assert.deepEqual(dailyCalls, []);
});

test('an invalid or missing explicit filter target never falls through to a configured fallback', async () => {
  const { resolveTpsBaseWriteTarget, TFile } = await loadModule();
  const dailyFile = new TFile('Daily/2026-07-24.md');
  const { host, dailyCalls } = createHost(TFile, {
    fallbackMode: 'today-daily-note',
    dailyNote: dailyFile,
  });

  const invalid = await resolveTpsBaseWriteTarget(host, {
    explicitTargetPath: '[[#Tasks]]',
    explicitTargetSpecified: true,
    createExplicitIfMissing: true,
    todayIsoDate: () => '2026-07-24',
  });
  assert.equal(invalid.file, null);
  assert.equal(invalid.source, 'filter');
  assert.equal(invalid.reason, 'invalid-filter-target');

  const missing = await resolveTpsBaseWriteTarget(host, {
    explicitTargetPath: 'Projects/Missing.md',
    explicitTargetSpecified: true,
    createExplicitIfMissing: false,
    todayIsoDate: () => '2026-07-24',
  });
  assert.equal(missing.file, null);
  assert.equal(missing.source, 'filter');
  assert.equal(missing.path, 'Projects/Missing.md');
  assert.equal(missing.reason, 'filter-target-not-found');
  assert.deepEqual(dailyCalls, []);
});

test('specific-note fallback reports missing and non-Markdown targets without creating files', async () => {
  const { resolveTpsBaseWriteTarget, TFile } = await loadModule();
  const missingHost = createHost(TFile, {
    fallbackMode: 'specific-note',
    fallbackPath: 'Projects/Missing',
  });
  const missing = await resolveTpsBaseWriteTarget(missingHost.host, {
    todayIsoDate: () => '2026-07-24',
  });
  assert.equal(missing.file, null);
  assert.equal(missing.source, 'specific-note');
  assert.equal(missing.path, 'Projects/Missing.md');
  assert.equal(missing.reason, 'specific-note-not-found');
  assert.deepEqual(missingHost.createdFiles, []);

  const nonMarkdownHost = createHost(TFile, {
    fallbackMode: 'specific-note',
    fallbackPath: 'Projects/Board.canvas',
  });
  const nonMarkdown = await resolveTpsBaseWriteTarget(nonMarkdownHost.host, {
    todayIsoDate: () => '2026-07-24',
  });
  assert.equal(nonMarkdown.file, null);
  assert.equal(nonMarkdown.source, 'specific-note');
  assert.equal(nonMarkdown.path, 'Projects/Board.canvas');
  assert.equal(nonMarkdown.reason, 'specific-note-not-markdown');
  assert.deepEqual(nonMarkdownHost.createdFiles, []);
});

test('List-style explicit creation creates missing folders and a Markdown target note', async () => {
  const { resolveTpsBaseWriteTarget, TFile } = await loadModule();
  const { host, createdFolders, createdFiles, dailyCalls } = createHost(TFile, {
    fallbackMode: 'today-daily-note',
    dailyNote: new TFile('Daily/2026-07-24.md'),
  });

  const result = await resolveTpsBaseWriteTarget(host, {
    explicitTargetPath: 'Inbox/Projects/New Tasks',
    explicitTargetSpecified: true,
    createExplicitIfMissing: true,
    todayIsoDate: () => '2026-07-24',
  });

  assert.ok(result.file instanceof TFile);
  assert.equal(result.source, 'filter');
  assert.equal(result.path, 'Inbox/Projects/New Tasks.md');
  assert.equal(result.reason, 'resolved');
  assert.deepEqual(createdFolders, ['Inbox', 'Inbox/Projects']);
  assert.deepEqual(createdFiles, [{
    path: 'Inbox/Projects/New Tasks.md',
    content: '---\ntitle: "New Tasks"\n---\n',
  }]);
  assert.deepEqual(dailyCalls, []);
});
