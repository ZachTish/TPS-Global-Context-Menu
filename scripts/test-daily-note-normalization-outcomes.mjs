import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadModule(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'daily-note-outcome-obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({
          path: 'obsidian-stub',
          namespace: 'daily-note-outcome-stub',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'daily-note-outcome-stub' }, () => ({
          contents: `
            export class App {}
            export class Component {
              registerEvent() {}
            }
            export class Modal {
              constructor(app) { this.app = app; }
              open() {}
              close() {}
            }
            export class FuzzySuggestModal extends Modal {}
            export class WorkspaceLeaf {}
            export class TFile {
              constructor(path) {
                this.path = path;
                this.extension = path.includes('.') ? path.split('.').pop() : '';
                this.basename = path.split('/').pop().replace(/\\.[^.]+$/, '');
                const slash = path.lastIndexOf('/');
                this.parent = { path: slash >= 0 ? path.slice(0, slash) : '/' };
              }
              static [Symbol.hasInstance](value) {
                return Boolean(value && typeof value.path === 'string' && typeof value.extension === 'string');
              }
            }
            export class Notice {
              constructor(message) {
                globalThis.__dailyNoteOutcomeNotices.push(String(message));
              }
            }
            export const Platform = { isMobile: false };
            export const moment = Object.assign(() => ({
              isValid: () => false,
              format: () => '',
            }), {
              invalid: () => ({ isValid: () => false }),
              ISO_8601: Symbol('ISO_8601'),
            });
            export const normalizePath = (value) => String(value || '').replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/');
            export const parseYaml = () => ({});
            export const setIcon = () => undefined;
            export const stringifyYaml = () => '';
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

globalThis.__dailyNoteOutcomeNotices = [];

const { DailyNoteNavManager } = await loadModule('../src/handlers/daily-note-nav-manager.ts');
const { NoteOperationService } = await loadModule('../src/services/note-operation-service.ts');

function createHarness(ServiceClass, outcome, initialFrontmatter = {}, leadingNormalizationError = null) {
  const file = {
    path: 'System/Dailynotes/2026-07-20.md',
    extension: 'md',
    basename: '2026-07-20',
    parent: { path: 'System/Dailynotes' },
  };
  const frontmatter = { ...initialFrontmatter };
  const calls = {
    fileNaming: 0,
    notebookNavigator: 0,
    process: 0,
  };
  const plugin = {
    settings: { autoSaveFolderPath: true },
    app: {
      vault: {
        async process(_target, mutator) {
          if (leadingNormalizationError) throw leadingNormalizationError;
          const current = '---\ntitle: existing\n---\n';
          mutator(current);
        },
        async cachedRead() {
          return '---\ntitle: existing\n---\n';
        },
        getAbstractFileByPath(path) {
          return path === file.path ? file : null;
        },
      },
    },
    frontmatterMutationService: {
      async processGuardedWithOutcome(target, mutator) {
        assert.equal(target, file);
        calls.process += 1;
        mutator(frontmatter);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    },
    fileNamingService: {
      async processFileOnOpen() {
        calls.fileNaming += 1;
      },
    },
    notebookNavigatorRuleService: {
      async applyRulesToFile() {
        calls.notebookNavigator += 1;
      },
    },
  };
  return {
    calls,
    file,
    frontmatter,
    service: new ServiceClass(plugin),
  };
}

for (const [name, ServiceClass] of [
  ['daily navigation', DailyNoteNavManager],
  ['note operations', NoteOperationService],
]) {
  test(`${name} accepts a committed daily-note normalization`, async () => {
    globalThis.__dailyNoteOutcomeNotices.length = 0;
    const harness = createHarness(ServiceClass, 'changed');

    const ready = await harness.service.normalizeCreatedDailyNote(
      harness.file,
      'July 20, 2026',
      'System/Dailynotes',
      '2026-07-20',
    );

    assert.equal(ready, true);
    assert.equal(harness.frontmatter.title, 'July 20, 2026');
    assert.equal(harness.frontmatter.scheduled, '2026-07-20 00:00:00');
    assert.equal(harness.frontmatter.folderPath, 'System/Dailynotes');
    assert.deepEqual(harness.calls, { fileNaming: 1, notebookNavigator: 1, process: 1 });
    assert.deepEqual(globalThis.__dailyNoteOutcomeNotices, []);
  });

  test(`${name} preserves an already-ready daily note`, async () => {
    globalThis.__dailyNoteOutcomeNotices.length = 0;
    const harness = createHarness(ServiceClass, 'unchanged', {
      title: 'July 20, 2026',
      scheduled: '2026-07-20 00:00:00',
      folderPath: 'System/Dailynotes',
    });

    const ready = await harness.service.normalizeCreatedDailyNote(
      harness.file,
      'July 20, 2026',
      'System/Dailynotes',
      '2026-07-20',
    );

    assert.equal(ready, true);
    assert.deepEqual(harness.calls, { fileNaming: 1, notebookNavigator: 1, process: 1 });
    assert.deepEqual(globalThis.__dailyNoteOutcomeNotices, []);
  });

  for (const outcome of ['guarded-abort', 'parse-failed', 'write-refused', 'unsupported']) {
    test(`${name} fails closed when daily-note normalization reports ${outcome}`, async () => {
      globalThis.__dailyNoteOutcomeNotices.length = 0;
      const harness = createHarness(ServiceClass, outcome);

      const ready = await harness.service.normalizeCreatedDailyNote(
        harness.file,
        'July 20, 2026',
        'System/Dailynotes',
        '2026-07-20',
      );

      assert.equal(ready, false);
      assert.deepEqual(harness.calls, { fileNaming: 0, notebookNavigator: 0, process: 1 });
      assert.equal(globalThis.__dailyNoteOutcomeNotices.length, 1);
      assert.match(globalThis.__dailyNoteOutcomeNotices[0], /required properties could not be saved/i);
    });
  }

  test(`${name} fails closed when daily-note normalization throws`, async () => {
    globalThis.__dailyNoteOutcomeNotices.length = 0;
    const harness = createHarness(ServiceClass, new Error('unexpected mutation failure'));

    const ready = await harness.service.normalizeCreatedDailyNote(
      harness.file,
      'July 20, 2026',
      'System/Dailynotes',
      '2026-07-20',
    );

    assert.equal(ready, false);
    assert.deepEqual(harness.calls, { fileNaming: 0, notebookNavigator: 0, process: 1 });
    assert.equal(globalThis.__dailyNoteOutcomeNotices.length, 1);
  });

  test(`${name} catches an atomic leading-frontmatter normalization failure`, async () => {
    globalThis.__dailyNoteOutcomeNotices.length = 0;
    const harness = createHarness(ServiceClass, 'changed', {}, new Error('vault process rejected'));

    const ready = await harness.service.normalizeCreatedDailyNote(
      harness.file,
      'July 20, 2026',
      'System/Dailynotes',
      '2026-07-20',
    );

    assert.equal(ready, false);
    assert.deepEqual(harness.calls, { fileNaming: 0, notebookNavigator: 0, process: 0 });
    assert.equal(globalThis.__dailyNoteOutcomeNotices.length, 1);
  });
}

test('daily-note ensure paths preserve the created/existing note when metadata normalization is refused', () => {
  const dailyNavSource = read('src/handlers/daily-note-nav-manager.ts');
  const noteOperationSource = read('src/services/note-operation-service.ts');

  assert.equal(
    dailyNavSource.match(/await this\.normalizeCreatedDailyNote\([^\n]+\);/g)?.length,
    4,
    'existing-equivalent, exact-existing, core-created, and manually-created navigation paths preserve access to the note',
  );
  assert.equal(
    noteOperationSource.match(/await this\.normalizeCreatedDailyNote\([^\n]+\);/g)?.length,
    3,
    'equivalent-existing, exact-existing, and manually-created service paths preserve access to the note',
  );
  assert.doesNotMatch(dailyNavSource, /if \(!await this\.normalizeCreatedDailyNote\([^\n]+\)\) return null;/);
  assert.doesNotMatch(noteOperationSource, /if \(!await this\.normalizeCreatedDailyNote\([^\n]+\)\) return null;/);
  assert.match(dailyNavSource, /Filename and Notebook Navigator rule updates were skipped/);
  assert.match(noteOperationSource, /Filename and Notebook Navigator rule updates were skipped/);
  assert.match(dailyNavSource, /processGuardedWithOutcome\(file, \(fm: any\) =>/);
  assert.match(noteOperationSource, /processGuardedWithOutcome\(file, \(fm: any\) =>/);
  assert.doesNotMatch(dailyNavSource, /metadataAlreadyReady/);
  assert.doesNotMatch(noteOperationSource, /metadataAlreadyReady/);
});
