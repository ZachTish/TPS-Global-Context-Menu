import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
globalThis.__TpsTemplateProtectionParseYaml = parse;

async function importUtility() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/template-protection.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function importBulkEditService() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/bulk-edit-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'template-protection-obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /daily-note-task-schedule$/u }, () => ({
          path: 'daily-note-task-schedule',
          namespace: 'template-protection-test',
        }));
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian',
          namespace: 'template-protection-test',
        }));
        builder.onLoad({ filter: /^daily-note-task-schedule$/u, namespace: 'template-protection-test' }, () => ({
          contents: `
            export async function reconcileExistingDailyNoteForIsoDate(...args) {
              const handler = globalThis.__TpsReconcileDailyNoteForTemplateTest;
              return typeof handler === 'function' ? await handler(...args) : { status: 'missing' };
            }
          `,
          loader: 'js',
        }));
        builder.onLoad({ filter: /^obsidian$/u, namespace: 'template-protection-test' }, () => ({
          contents: `
            class Dummy {
              constructor() {}
              open() {}
            }
            class TFile extends Dummy {}
            globalThis.__TpsTemplateProtectionTFile = TFile;
            module.exports = new Proxy(
              {
                App: Dummy,
                Modal: Dummy,
                Notice: Dummy,
                TFile,
                WorkspaceLeaf: Dummy,
                parseYaml: source => globalThis.__TpsTemplateProtectionParseYaml(source),
                normalizePath(value) { return String(value || '').replace(/\\\\/g, '/'); },
              },
              { get(target, key) { return key in target ? target[key] : Dummy; } },
            );
          `,
          loader: 'js',
          resolveDir: repoRoot,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function makeFile(TFile, path) {
  const file = new TFile();
  const name = path.split('/').pop();
  file.path = path;
  file.name = name;
  file.basename = name.replace(/\.md$/iu, '');
  file.extension = 'md';
  file.parent = { path: path.includes('/') ? path.split('/').slice(0, -1).join('/') : '' };
  return file;
}

test('template identity recognizes only the exact top-level YAML tag marker', async () => {
  const {
    inspectTemplateProtectionFrontmatter,
    inspectTemplateProtectionSource,
  } = await importUtility();

  for (const source of [
    '---\ntags: template\n---\nBody\n',
    '---\ntags: [keep, "#Template"]\n---\nBody\n',
    '---\ntags:\n  - keep\n  - TEMPLATE\n---\nBody\n',
  ]) {
    assert.equal(inspectTemplateProtectionSource(source, 'template'), 'protected');
  }

  assert.equal(
    inspectTemplateProtectionSource('---\ntags: [template/example, keep]\n---\n#template\n', 'template'),
    'unprotected',
    'nested and body tags are not source identity markers',
  );
  assert.equal(
    inspectTemplateProtectionSource('Body only\n\n#template\n', 'template'),
    'unprotected',
  );
  assert.equal(inspectTemplateProtectionSource('---\ntags:\n  value: template\n---\n', 'template'), 'unsafe');
  assert.equal(inspectTemplateProtectionSource('---\ntags: template\n', 'template'), 'unsafe');
  assert.equal(
    inspectTemplateProtectionSource('---\ndescription: |\n  ---\n  ...\n  literal block\ntags: [template]\n---\n', 'template'),
    'protected',
    'indented YAML delimiter text inside a block scalar is not the end of frontmatter',
  );
  assert.equal(inspectTemplateProtectionSource('  ---\ntags: template\n---\n', 'template'), 'unsafe');
  assert.equal(inspectTemplateProtectionFrontmatter({ tags: ['keep', '#TEMPLATE'] }, 'template'), 'protected');
  assert.equal(inspectTemplateProtectionFrontmatter({ tags: ['template/example'] }, 'template'), 'unprotected');
  assert.equal(inspectTemplateProtectionFrontmatter({ tags: { value: 'template' } }, 'template'), 'unsafe');
});

test('instance sanitization removes only the configured marker and preserves source order and body bytes', async () => {
  const {
    removeTemplateProtectionTagFromFrontmatter,
    stripTemplateProtectionTagFromSource,
  } = await importUtility();

  const source = [
    '\uFEFF---\r\n',
    'title: Daily template\r\n',
    'tags:\r\n',
    '  - before\r\n',
    '  - "#Template"\r\n',
    '  - template/example\r\n',
    '  - after\r\n',
    'kind: dailynote\r\n',
    '---\r\n',
    '#template stays in the body\r\n',
  ].join('');
  const expected = source.replace('  - "#Template"\r\n', '');
  assert.equal(stripTemplateProtectionTagFromSource(source, { templateIdentificationTag: 'template' }), expected);

  const flow = '---\ntags: [ first,\tTEMPLATE ,  template/example,last ] # retain spacing\n---\nBody\n';
  assert.equal(
    stripTemplateProtectionTagFromSource(flow, 'template'),
    '---\ntags: [ first,  template/example,last ] # retain spacing\n---\nBody\n',
    'flow cleanup removes only the marker token and its delimiter bytes',
  );
  assert.equal(
    stripTemplateProtectionTagFromSource('---\ntags: [keep, template, TEMPLATE]\n---\n', 'template'),
    '---\ntags: [keep]\n---\n',
    'adjacent matching flow entries are removed as one source range',
  );
  assert.equal(
    stripTemplateProtectionTagFromSource('---\ntags: [template, keep, TEMPLATE]\n---\n', 'template'),
    '---\ntags: [ keep]\n---\n',
    'matching first and last entries preserve the untouched middle token bytes',
  );

  const frontmatter = { title: 'Instance', tags: ['before', '#Template', 'template/example', 'after'] };
  assert.equal(removeTemplateProtectionTagFromFrontmatter(frontmatter, 'template'), true);
  assert.deepEqual(frontmatter, { title: 'Instance', tags: ['before', 'template/example', 'after'] });
});

test('automatic-write exclusions preserve path rules and add exact authoritative tag rules', async () => {
  const {
    canAutomaticallyMutateTemplateFile,
    canAutomaticallyMutateTemplateFrontmatter,
    canAutomaticallyMutateTemplateSource,
    matchesAutomaticMutationPathExclusion,
    parseAutomaticMutationTagExclusion,
    updateAutomaticMutationTagExclusion,
  } = await importUtility();
  let source = '---\ntags: keep\n---\n';
  const vault = { read: async () => source };
  const file = { path: 'Templates/Daily.md', name: 'Daily.md', basename: 'Daily' };

  assert.equal(await canAutomaticallyMutateTemplateFile(vault, file, { templateIdentificationTag: 'template' }), true, 'template identity alone does not exclude');
  assert.equal(await canAutomaticallyMutateTemplateFile({}, file, ''), true, 'no tag rule needs no source read');
  assert.equal(await canAutomaticallyMutateTemplateFile({}, file, 'path:Templates/'), false);
  assert.equal(await canAutomaticallyMutateTemplateFile({}, file, 'path:Templates\\'), false, 'Windows separators retain path exclusion semantics');
  assert.equal(await canAutomaticallyMutateTemplateFile({}, file, 'path:./Templates//'), false, 'redundant path segments retain exclusion semantics');
  assert.equal(await canAutomaticallyMutateTemplateFile({}, file, 'name:Daily'), false);
  assert.equal(await canAutomaticallyMutateTemplateFile({}, file, 're:^Templates/'), false);
  assert.equal(matchesAutomaticMutationPathExclusion(file.path, file.basename, 'Templates/*.md'), true);
  assert.equal(matchesAutomaticMutationPathExclusion(file.path, file.basename, 'tag:template'), false);
  assert.equal(parseAutomaticMutationTagExclusion('tag:#Template'), 'template');
  assert.equal(parseAutomaticMutationTagExclusion('#Project/Template'), 'project/template');
  const addedByTagChooser = updateAutomaticMutationTagExclusion(
    'Templates/, tag:template/example\nname:Daily',
    '#Template',
    true,
  );
  assert.deepEqual(addedByTagChooser.split('\n'), [
    'Templates/',
    'tag:template/example',
    'name:Daily',
    'tag:template',
  ]);
  assert.equal(updateAutomaticMutationTagExclusion(addedByTagChooser, 'TEMPLATE', false), [
    'Templates/',
    'tag:template/example',
    'name:Daily',
  ].join('\n'));
  assert.equal(
    updateAutomaticMutationTagExclusion('Templates/', 'not a tag', true),
    'Templates/',
  );

  const explicitTagRule = { frontmatterAutoWriteExclusions: 'tag:template' };
  assert.equal(await canAutomaticallyMutateTemplateFile(vault, file, explicitTagRule), true);
  source = '---\ntags: template\n---\n';
  assert.equal(await canAutomaticallyMutateTemplateFile(vault, file, explicitTagRule), false);
  assert.equal(canAutomaticallyMutateTemplateSource(source, explicitTagRule), false);
  assert.equal(canAutomaticallyMutateTemplateFrontmatter({ tags: ['template'] }, explicitTagRule), false);
  assert.equal(canAutomaticallyMutateTemplateFrontmatter({ tags: ['template/example'] }, explicitTagRule), true, 'tag matching is exact');
  assert.equal(canAutomaticallyMutateTemplateSource('---\ntags: [template/example]\n---\n', '#template'), true);
  assert.equal(canAutomaticallyMutateTemplateSource('---\ntags:\n  value: template\n---\n', '#template'), false, 'ambiguous tag evidence fails closed');
  assert.equal(await canAutomaticallyMutateTemplateFile({ read: async () => { throw new Error('offline'); } }, file, explicitTagRule), false);
  assert.equal(await canAutomaticallyMutateTemplateFile({}, file, explicitTagRule), false);
});

test('automatic background writers recheck explicit exclusions at their mutation boundaries', () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const checkboxHandler = read('src/handlers/task-checkbox-handler.ts');
  const events = read('src/events/register-events.ts');
  const nativeRecords = read('src/services/native-record-service.ts');
  const noteOperations = read('src/services/note-operation-service.ts');
  const bulkEdit = read('src/services/bulk-edit-service.ts');
  assert.doesNotMatch(checkboxHandler, /scheduleChecklistPropertyUpdate|updateChecklistPropertyForFile|synchronizeChecklistPropertyForAllMarkdownFiles|pendingPropertyUpdateTimers|recentPropertyWriteUntilByPath|fullVaultSyncToken/);
  assert.doesNotMatch(
    events,
    /writeConfiguredStatus|scheduleExternalChecklistCompletionGuard|checklistCompletionGuardTimers/u,
    'metadata observers must not contain a passive status/completion rollback writer',
  );
  assert.match(
    nativeRecords,
    /adoptNewTaskDraftInternal[\s\S]{0,650}canAutomaticallyMutateTemplateSource[\s\S]{0,1300}vault\.process[\s\S]{0,220}canAutomaticallyMutateTemplateSource/u,
  );
  assert.doesNotMatch(noteOperations, /sweepArchiveTaggedFiles/);
  assert.doesNotMatch(bulkEdit, /runDeletedLinkCleanup|cleanupLinksForDeletedFile/);
});

test('retired startup recovery cannot inspect or change recurring notes', async () => {
  const { BulkEditService } = await importBulkEditService();
  const TFile = globalThis.__TpsTemplateProtectionTFile;
  const protectedFile = makeFile(TFile, 'Inbox/Protected recurrence.md');
  const unsafeFile = makeFile(TFile, 'Inbox/Unsafe recurrence.md');
  const sources = new Map([
    [protectedFile.path, '---\ntags: [template]\nrecurrenceRule: FREQ=DAILY\nstatus: complete\n---\n'],
    [unsafeFile.path, '---\ntags: [template\nrecurrenceRule: FREQ=DAILY\nstatus: complete\n'],
  ]);
  const ordinary = Array.from({ length: 1000 }, (_, i) => makeFile(TFile, `Inbox/ordinary-${i}.md`));
  let rawReads = 0;
  let createNextCalls = 0;
  let frontmatterWrites = 0;
  let recurrenceStateWrites = 0;
  const plugin = {
    manifest: { dir: '.obsidian/plugins/tps-global-context-menu' },
    settings: {
      enableRecurrence: true,
      recurrenceCompletionStatuses: ['complete'],
      recurringTemplateFolder: '',
      templateIdentificationTag: 'template',
    },
    app: {
      vault: {
        getMarkdownFiles: () => [...ordinary, protectedFile, unsafeFile],
        read: async (file) => { rawReads++; assert.ok(sources.has(file.path), 'ordinary notes must not be read'); return sources.get(file.path); },
        adapter: {
          write: async () => { recurrenceStateWrites += 1; },
        },
      },
      metadataCache: {
        getFileCache: (file) => ordinary.includes(file) ? { frontmatter: { title: 'Ordinary' } } : ({
          frontmatter: {
            recurrenceRule: 'FREQ=DAILY',
            status: 'complete',
            scheduled: '2026-09-01 09:00:00',
          },
        }),
      },
    },
    filePropertiesService: { isCompanionFile: () => false },
    fileNamingService: { isDailyNoteFile: async () => false },
    frontmatterMutationService: {
      process: async () => { frontmatterWrites += 1; },
    },
  };
  const service = new BulkEditService(plugin);
  service.createNextRecurrenceInstance = async () => {
    createNextCalls += 1;
    return true;
  };

  assert.equal(service.checkMissingRecurrences, undefined);

  assert.equal(rawReads, 0);
  assert.equal(createNextCalls, 0);
  assert.equal(frontmatterWrites, 0);
  assert.equal(recurrenceStateWrites, 0);
  assert.equal(sources.get(protectedFile.path).includes('tags: [template]'), true);
});



test('note completion edits status without recurrence scans or successor creation', async () => {
  const { BulkEditService } = await importBulkEditService();
  const TFile = globalThis.__TpsTemplateProtectionTFile;
  const file = makeFile(TFile, 'Inbox/Repeat.md');
  const fm = { status: 'todo', recurrenceRule: 'FREQ=DAILY', scheduled: '2026-10-15', id: 'original' };
  let inventories = 0, metadata = 0, successors = 0, edits = 0;
  const plugin = {
    settings: { enableRecurrence: true, promptOnRecurrenceEdit: true, recurrencePromptTimeout: 30, properties: [], recurrenceCompletionStatuses: ['complete', 'wont-do'] },
    app: { vault: { getMarkdownFiles() { inventories++; return [file]; } }, metadataCache: {
      getFileCache() { metadata++; return { frontmatter: fm }; },
    } },
  };
  const service = new BulkEditService(plugin);
  service.createNextRecurrenceInstance = async () => { successors++; return true; };
  service.applyToFiles = async (files, mutate) => { assert.deepEqual(files, [file]); edits++; mutate(fm); return 1; };
  for (const status of ['complete', 'todo', 'wont-do']) {
    assert.equal(await service.updateFrontmatter([file], { status }), 1);
    assert.equal(fm.status, status);
    assert.equal(fm.recurrenceRule, 'FREQ=DAILY');
    assert.equal(fm.id, 'original');
  }
  assert.equal(await service.updateFrontmatter([file], { title: 'Edited title' }), 1);
  assert.equal(fm.title, 'Edited title');
  assert.deepEqual({ inventories, metadata, successors, edits }, { inventories: 0, metadata: 0, successors: 0, edits: 4 });
});


test('automatic archive scheduler, sweep and last-run writes are deleted', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const operations = readFileSync(new URL('../src/services/note-operation-service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /archiveSweepTimerId|startArchiveTagAutomation|stopArchiveTagAutomation|runArchiveTagSweepIfDue|scheduleNextArchiveTagSweep|lastArchiveTagSweepDate|enableArchiveTagMove/);
  assert.doesNotMatch(operations, /sweepArchiveTaggedFiles|fileHasArchiveTag|getEffectiveArchiveFolder|getUniqueArchiveTargetPath/);
  assert.match(operations, /archiveSourceNotes/);
});


test('retired recurrence generators and durable state helpers are absent', async () => {
 const { BulkEditService } = await importBulkEditService();
 for (const name of ['createNextRecurrenceInstance','createNextDailyNoteRecurrenceInstance','ensureRecurrenceTemplate','setRecurrence','bootstrapTemplateInstanceFromToday','saveRecurrenceOpState','tagParentsForLinkedChildren']) assert.equal(BulkEditService.prototype[name], undefined);
 const source = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /recurrenceCreationInProgress|recurrenceOpState|recurrenceLastGeneratedKey|beginRecurrenceOp|markRecurrenceGenerated/);
});
