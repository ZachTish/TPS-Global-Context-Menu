import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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
                normalizePath(value) { return String(value || '').replace(/\\\\/g, '/'); },
              },
              { get(target, key) { return key in target ? target[key] : Dummy; } },
            );
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function importArchiveSweepHarness() {
  const sourcePath = fileURLToPath(new URL('../src/services/note-operation-service.ts', import.meta.url));
  const source = readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let sweepMethod = null;
  const visit = (node) => {
    if (ts.isMethodDeclaration(node) && node.name?.getText(sourceFile) === 'sweepArchiveTaggedFiles') {
      sweepMethod = node.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(sweepMethod, 'missing sweepArchiveTaggedFiles');

  const virtualSource = `
    import { canAutomaticallyMutateTemplateFile } from './src/utils/template-protection.ts';
    export class TFile {
      constructor(path) {
        this.path = path;
        this.name = path.split('/').pop();
        this.basename = this.name.replace(/\\.md$/u, '');
        this.extension = 'md';
      }
    }
    const normalizePath = (value) => String(value || '').replace(/\\\\/gu, '/');
    const normalizeTagValue = (value) => String(value || '').replace(/^#/u, '').trim().toLowerCase();
    const logger = { warn: () => undefined, log: () => undefined, error: () => undefined };
    export class ArchiveSweepHarness {
      constructor(plugin) { this.plugin = plugin; this.app = plugin.app; }
      fileHasArchiveTag() { return true; }
      getEffectiveArchiveFolder(value) { return value; }
      async ensureFolderPath() {}
      getUniqueArchiveTargetPath(file, folder) { return folder + '/' + file.name; }
      ${sweepMethod}
    }
  `;
  const result = await build({
    stdin: {
      contents: virtualSource,
      resolveDir: repoRoot,
      sourcefile: 'archive-sweep-template-protection-harness.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
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

test('background archive sweeps honor explicit tag exclusions while a manual sweep remains explicit', async () => {
  const { ArchiveSweepHarness, TFile } = await importArchiveSweepHarness();
  const run = async (reason) => {
    const protectedFile = new TFile('Templates/Daily.md');
    const ordinaryFile = new TFile('Inbox/Ordinary.md');
    const files = [protectedFile, ordinaryFile];
    const sources = new Map([
      [protectedFile.path, '---\ntags: [template, archive]\n---\n'],
      [ordinaryFile.path, '---\ntags: [archive]\n---\n'],
    ]);
    const renamed = [];
    const plugin = {
      settings: {
        archiveTag: 'archive',
        templateIdentificationTag: 'template',
        frontmatterAutoWriteExclusions: 'tag:template',
      },
      getArchiveFolderPath: () => '_archive',
      filePropertiesService: { isCompanionFile: () => false },
      runQueuedMove: async (_files, callback) => callback(),
      app: {
        vault: {
          getMarkdownFiles: () => files,
          getAbstractFileByPath: (path) => files.find((file) => file.path === path) || null,
          read: async (file) => sources.get(file.path),
        },
        fileManager: {
          renameFile: async (file, targetPath) => renamed.push([file.path, targetPath]),
        },
      },
    };
    const service = new ArchiveSweepHarness(plugin);
    const result = await service.sweepArchiveTaggedFiles(reason);
    return { renamed, result };
  };

  const scheduled = await run('scheduled');
  assert.deepEqual(scheduled.renamed, [['Inbox/Ordinary.md', '_archive/Ordinary.md']]);
  assert.equal(scheduled.result.archived, 1);

  const manual = await run('manual');
  assert.deepEqual(manual.renamed, [
    ['Templates/Daily.md', '_archive/Daily.md'],
    ['Inbox/Ordinary.md', '_archive/Ordinary.md'],
  ]);
  assert.equal(manual.result.archived, 2);
});

test('automatic background writers recheck explicit exclusions at their mutation boundaries', () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const navigatorRules = read('src/services/notebook-navigator-rule-service.ts');
  const checkboxHandler = read('src/handlers/task-checkbox-handler.ts');
  const checkboxReconcile = read('src/services/task-status-checkbox-reconcile-service.ts');
  const events = read('src/events/register-events.ts');
  const nativeRecords = read('src/services/native-record-service.ts');
  const noteOperations = read('src/services/note-operation-service.ts');
  const bulkEdit = read('src/services/bulk-edit-service.ts');

  assert.match(
    navigatorRules,
    /isAutomaticMutation[\s\S]{0,400}passesRuleExclusionPreflight\([\s\S]{0,180}frontmatterAutoWriteExclusions[\s\S]{0,1200}canAutomaticallyMutateTemplateFrontmatter/u,
  );
  assert.match(navigatorRules, /reason === 'gcm-startup-auto'/u);
  assert.match(
    checkboxHandler,
    /updateChecklistPropertyForFile[\s\S]{0,300}canAutomaticallyMutateTemplateFile[\s\S]{0,1200}canAutomaticallyMutateTemplateFrontmatter/u,
  );
  assert.match(
    checkboxReconcile,
    /reconcileFileNow[\s\S]{0,300}canAutomaticallyMutateTemplateFile[\s\S]{0,700}canAutomaticallyMutateTemplateSource/u,
  );
  assert.match(
    events,
    /writeConfiguredStatus[\s\S]{0,240}canAutomaticallyMutateTemplateFile[\s\S]{0,420}canAutomaticallyMutateTemplateFrontmatter/u,
  );
  assert.match(
    events,
    /reconcileCompletedDate[\s\S]{0,300}canAutomaticallyMutateTemplateFile[\s\S]{0,600}canAutomaticallyMutateTemplateFrontmatter/u,
  );
  assert.match(
    nativeRecords,
    /adoptNewTaskDraftInternal[\s\S]{0,650}canAutomaticallyMutateTemplateSource[\s\S]{0,1300}vault\.process[\s\S]{0,220}canAutomaticallyMutateTemplateSource/u,
  );
  assert.match(
    noteOperations,
    /sweepArchiveTaggedFiles[\s\S]{0,2200}reason !== "manual"[\s\S]{0,260}canAutomaticallyMutateTemplateFile[\s\S]{0,500}renameFile/u,
    'background archive sweeps recheck current exclusion evidence while manual sweeps remain explicit',
  );
  assert.match(
    bulkEdit,
    /runDeletedLinkCleanup[\s\S]{0,3500}canAutomaticallyMutateTemplateFile[\s\S]{0,1000}frontmatterMutationService\.process\(file,[\s\S]{0,260}canAutomaticallyMutateTemplateFrontmatter/u,
    'automatic deleted-link frontmatter cleanup checks both current bytes and mutation-boundary frontmatter',
  );
  assert.match(
    bulkEdit,
    /const raw = await this\.plugin\.app\.vault\.cachedRead\(file\);[\s\S]{0,180}canAutomaticallyMutateTemplateSource\(raw,[\s\S]{0,1000}vault\.process\(file, \(current\) =>[\s\S]{0,180}canAutomaticallyMutateTemplateSource\(current,/u,
    'automatic deleted-link body cleanup rechecks exact bytes inside Vault.process',
  );
});

test('recurrence instances and propagation remove only the configured source-template marker', () => {
  const bulkEdit = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');
  const methodSource = (start, end) => {
    const startIndex = bulkEdit.indexOf(start);
    const endIndex = bulkEdit.indexOf(end, startIndex + start.length);
    assert.notEqual(startIndex, -1, `missing method start: ${start}`);
    assert.notEqual(endIndex, -1, `missing method end: ${end}`);
    return bulkEdit.slice(startIndex, endIndex);
  };
  const dailyRecurrence = methodSource(
    'private async createNextDailyNoteRecurrenceInstance',
    'private getRecurrenceStatePath',
  );
  const noteRecurrence = methodSource(
    'async createNextRecurrenceInstance',
    'async applyTemplateToOpenInstances',
  );
  const propagation = methodSource(
    'async applyTemplateToOpenInstances',
    'async checkMissingRecurrences',
  );
  const startupHealing = methodSource(
    'async checkMissingRecurrences',
    'async clearRecurrenceRule',
  );

  assert.match(
    bulkEdit,
    /buildDailyNoteContent[\s\S]{0,1100}sanitizeRecurrenceInstanceSource/u,
  );
  assert.ok(
    dailyRecurrence.indexOf('await this.buildDailyNoteContent')
      < dailyRecurrence.indexOf('await this.beginRecurrenceOp'),
    'Daily Note template validation must precede durable recurrence operation state',
  );
  assert.match(dailyRecurrence, /isVerifiedRecurrenceInstance\(newFile, 'daily-note recurrence creation'\)/u);
  assert.match(dailyRecurrence, /isVerifiedRecurrenceInstancePath\(newFilePath, 'existing daily-note recurrence'\)/u);
  const bootstrap = methodSource(
    'private async bootstrapTemplateInstanceFromToday',
    'private advanceOccurrenceToFuture',
  );
  assert.match(bootstrap, /readRecurrenceInstanceSource\([\s\S]{0,180}'recurrence-template bootstrap'/u);
  assert.match(bootstrap, /removeTemplateProtectionTagFromFrontmatter\(fmw, this\.plugin\.settings\)/u);
  assert.match(
    dailyRecurrence,
    /removeTemplateProtectionTagFromFrontmatter\(fm, this\.plugin\.settings\)/u,
  );
  assert.match(
    noteRecurrence,
    /removeTemplateProtectionTagFromFrontmatter\(fm, this\.plugin\.settings\)/u,
  );
  assert.match(
    propagation,
    /propagatableFrontmatter[\s\S]{0,220}removeTemplateProtectionTagFromFrontmatter/u,
  );
  assert.match(startupHealing, /inspectTemplateProtectionSource\(source, this\.plugin\.settings\)/u);
  assert.match(startupHealing, /templateProtectionState === 'protected'[\s\S]{0,700}bootstrapTemplateInstanceFromToday/u);
  assert.match(startupHealing, /canAutomaticallyMutateTemplateFile[\s\S]{0,450}canMutateFrontmatterSafely/u);
  assert.match(startupHealing, /canAutomaticallyMutateTemplateFrontmatter\(fmw, this\.plugin\.settings\)/u);
});

test('startup recurrence healing does not treat template identity as a global ignore outside the template folder', async () => {
  const { BulkEditService } = await importBulkEditService();
  const TFile = globalThis.__TpsTemplateProtectionTFile;
  const protectedFile = makeFile(TFile, 'Inbox/Protected recurrence.md');
  const unsafeFile = makeFile(TFile, 'Inbox/Unsafe recurrence.md');
  const sources = new Map([
    [protectedFile.path, '---\ntags: [template]\nrecurrenceRule: FREQ=DAILY\nstatus: complete\n---\n'],
    [unsafeFile.path, '---\ntags: [template\nrecurrenceRule: FREQ=DAILY\nstatus: complete\n'],
  ]);
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
        getMarkdownFiles: () => [protectedFile, unsafeFile],
        read: async (file) => sources.get(file.path),
        adapter: {
          write: async () => { recurrenceStateWrites += 1; },
        },
      },
      metadataCache: {
        getFileCache: () => ({
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

  await service.checkMissingRecurrences();

  assert.equal(createNextCalls, 1, 'safe template identity is not an implicit exclusion, while ambiguous YAML remains fail-closed');
  assert.equal(frontmatterWrites, 0);
  assert.equal(recurrenceStateWrites, 0);
  assert.equal(sources.get(protectedFile.path).includes('tags: [template]'), true);
});

test('recurrence-template bootstrap reads a protected blueprint and creates a verified untagged instance', async () => {
  const { BulkEditService } = await importBulkEditService();
  const TFile = globalThis.__TpsTemplateProtectionTFile;
  const templateFile = makeFile(TFile, 'Recurring Templates/Standup.md');
  const templateSource = [
    '---\n',
    'tags: [template, keep]\n',
    'recurrenceRule: FREQ=DAILY\n',
    '---\n',
    '#template remains body content\n',
  ].join('');
  const sources = new Map([[templateFile.path, templateSource]]);
  const files = new Map([[templateFile.path, templateFile]]);
  const processedPaths = [];
  const createdInputs = [];
  const plugin = {
    settings: { templateIdentificationTag: 'template' },
    app: {
      vault: {
        getMarkdownFiles: () => [...files.values()],
        getAbstractFileByPath: (path) => files.get(path) || null,
        read: async (file) => sources.get(file.path),
        create: async (path, content) => {
          const created = makeFile(TFile, path);
          files.set(path, created);
          sources.set(path, content);
          createdInputs.push({ path, content });
          return created;
        },
      },
      metadataCache: {
        getFileCache: () => null,
        fileToLinktext: (file) => file.basename,
      },
    },
    filePropertiesService: { isCompanionFile: () => false },
    frontmatterMutationService: {
      process: async (file, mutate) => {
        processedPaths.push(file.path);
        mutate({ tags: ['keep'] });
      },
    },
  };
  const service = new BulkEditService(plugin);
  service.getFirstOccurrenceFromToday = () => new Date(2026, 8, 3, 9, 0, 0);
  const originalWindow = globalThis.window;
  globalThis.window = {
    moment: () => ({
      format: (format) => format === 'YYYY-MM-DD HH:mm:ss'
        ? '2026-09-03 09:00:00'
        : '2026-09-03',
    }),
  };

  try {
    const result = await service.bootstrapTemplateInstanceFromToday(templateFile, {
      recurrenceRule: 'FREQ=DAILY',
      recurrenceTemplate: true,
    });

    assert.equal(result, true, JSON.stringify({ createdInputs, processedPaths, sources: [...sources] }));
    assert.equal(createdInputs.length, 1);
    assert.equal(createdInputs[0].content.includes('template, keep'), false);
    assert.match(createdInputs[0].content, /tags:\s*\[\s*keep\s*\]/u);
    assert.equal(createdInputs[0].content.includes('#template remains body content'), true);
    assert.deepEqual(processedPaths, [createdInputs[0].path], 'the protected blueprint itself stays read-only');
    assert.equal(sources.get(templateFile.path), templateSource);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('generic recurrence cloning strips the source marker before create and fails closed on unsafe templates', async () => {
  const { BulkEditService } = await importBulkEditService();
  const TFile = globalThis.__TpsTemplateProtectionTFile;

  const runClone = async (templateSource, options = {}) => {
    const instance = makeFile(TFile, 'Inbox/Standup 2026-09-01.md');
    const template = makeFile(TFile, 'Recurring Templates/Standup.md');
    const sources = new Map([
      [instance.path, '---\ntags: [work]\nrecurrenceRule: GCM-TRACKER\n---\nCompleted body\n'],
      [template.path, templateSource],
    ]);
    const files = new Map([[instance.path, instance], [template.path, template]]);
    const createdInputs = [];
    let stateWrites = 0;
    let generatedMarks = 0;
    const plugin = {
      manifest: { dir: '.obsidian/plugins/tps-global-context-menu' },
      settings: {
        templateIdentificationTag: 'template',
        recurringTemplateFolder: 'Recurring Templates',
        recurrenceDefaultStatus: '',
      },
      app: {
        vault: {
          getAbstractFileByPath: (path) => files.get(path) || null,
          read: async (file) => sources.get(file.path),
          create: async (path, content) => {
            const created = makeFile(TFile, path);
            files.set(path, created);
            sources.set(path, content);
            createdInputs.push({ path, content });
            return created;
          },
          adapter: {
            exists: async (path) => sources.has(path),
            read: async () => '',
            write: async () => { stateWrites += 1; },
          },
        },
        metadataCache: {
          fileToLinktext: (file) => file.basename,
        },
      },
      filePropertiesService: { isCompanionFile: () => false },
      frontmatterMutationService: {
        process: async (file, mutate) => {
          mutate({ tags: ['keep'] });
          if (options.outputAfterMutation) {
            sources.set(file.path, options.outputAfterMutation);
          }
        },
      },
    };
    const service = new BulkEditService(plugin);
    service.resolveRecurrenceInfo = () => ({
      rule: 'GCM-TRACKER',
      templateFile: template,
      seriesBaseName: 'Standup',
    });
    service.shouldSkipNoteLevelRecurrence = async () => false;
    service.markRecurrenceGenerated = async () => { generatedMarks += 1; };

    const result = await service.createNextRecurrenceInstance(instance, {
      recurrenceRule: 'GCM-TRACKER',
      status: 'complete',
    });
    return { result, createdInputs, stateWrites, generatedMarks };
  };

  const protectedClone = await runClone([
    '---\n',
    'tags: [template, keep]\n',
    'recurrenceRule: GCM-TRACKER\n',
    '---\n',
    '#template remains body content\n',
  ].join(''));
  assert.equal(protectedClone.result, true, JSON.stringify(protectedClone));
  assert.equal(protectedClone.createdInputs.length, 1);
  assert.match(protectedClone.createdInputs[0].content, /tags:\s*\[\s*keep\s*\]/u);
  assert.equal(protectedClone.createdInputs[0].content.includes('#template remains body content'), true);
  assert.equal(protectedClone.generatedMarks, 1);

  const contaminatedOutput = await runClone(
    '---\ntags: [template, keep]\nrecurrenceRule: GCM-TRACKER\n---\n',
    { outputAfterMutation: '---\ntags: [template, keep]\n---\n' },
  );
  assert.equal(contaminatedOutput.result, false);
  assert.equal(contaminatedOutput.createdInputs.length, 1, 'the pre-stripped clone was created before the simulated writer reintroduced the marker');
  assert.equal(contaminatedOutput.generatedMarks, 0, 'unverified output must not mark the source recurrence as generated');

  const unsafeClone = await runClone('---\ntags: [template\nrecurrenceRule: GCM-TRACKER\n');
  assert.equal(unsafeClone.result, false);
  assert.equal(unsafeClone.createdInputs.length, 0);
  assert.equal(unsafeClone.stateWrites, 0, 'unsafe input must fail before durable generation state is written');
});

test('Daily Note recurrence validates templates before locking and verifies new and existing outputs', async () => {
  const { BulkEditService } = await importBulkEditService();
  const TFile = globalThis.__TpsTemplateProtectionTFile;
  const originalWindow = globalThis.window;
  const originalReconcile = globalThis.__TpsReconcileDailyNoteForTemplateTest;
  globalThis.window = {
    moment: () => ({
      format: (format) => format === 'YYYY-MM-DD HH:mm:ss'
        ? '2026-09-04 09:00:00'
        : format === 'YYYY-MM-DD 00:00:00'
          ? '2026-09-04 00:00:00'
          : '2026-09-04',
    }),
  };

  const runDailyRecurrence = async ({
    templateSource,
    outputAfterMutation = null,
    existingSource = null,
  }) => {
    const sourceFile = makeFile(TFile, 'Daily Notes/2026-09-03.md');
    const templateFile = makeFile(TFile, 'Templates/Daily.md');
    const outputPath = 'Daily Notes/2026-09-04.md';
    const sources = new Map([
      [sourceFile.path, '---\ntags: [daily]\nrecurrenceRule: FREQ=DAILY\n---\n'],
      [templateFile.path, templateSource],
    ]);
    const files = new Map([
      [sourceFile.path, sourceFile],
      [templateFile.path, templateFile],
    ]);
    if (existingSource !== null) {
      const existingFile = makeFile(TFile, outputPath);
      files.set(outputPath, existingFile);
      sources.set(outputPath, existingSource);
    }
    globalThis.__TpsReconcileDailyNoteForTemplateTest = async () => {
      const existingFile = files.get(outputPath);
      return existingFile ? { status: 'found', file: existingFile } : { status: 'missing' };
    };

    const createdInputs = [];
    let stateWrites = 0;
    let generatedMarks = 0;
    const dailyConfig = {
      format: 'YYYY-MM-DD',
      folder: 'Daily Notes',
      template: 'Templates/Daily',
    };
    const plugin = {
      manifest: { dir: '.obsidian/plugins/tps-global-context-menu' },
      settings: { templateIdentificationTag: 'template' },
      app: {
        internalPlugins: {
          getPluginById: () => ({ instance: { options: dailyConfig } }),
        },
        vault: {
          configDir: '.obsidian',
          getAbstractFileByPath: (path) => files.get(path) || null,
          read: async (file) => sources.get(file.path),
          create: async (path, content) => {
            const created = makeFile(TFile, path);
            files.set(path, created);
            sources.set(path, content);
            createdInputs.push({ path, content });
            return created;
          },
          createFolder: async () => {},
          adapter: {
            exists: async (path) => path === 'Daily Notes' || sources.has(path),
            read: async (path) => path.endsWith('daily-notes.json')
              ? JSON.stringify(dailyConfig)
              : '',
            write: async () => { stateWrites += 1; },
          },
        },
      },
      frontmatterMutationService: {
        process: async (file, mutate) => {
          mutate({ tags: ['keep'] });
          if (outputAfterMutation !== null) sources.set(file.path, outputAfterMutation);
        },
      },
    };
    const service = new BulkEditService(plugin);
    service.markRecurrenceGenerated = async () => { generatedMarks += 1; };
    const existingGeneratedValue = existingSource === null
      ? undefined
      : '2026-09-04 00:00:00';
    const result = await service.createNextDailyNoteRecurrenceInstance(
      sourceFile,
      {
        recurrenceRule: 'FREQ=DAILY',
        recurrenceLastGenerated: existingGeneratedValue,
      },
      new Date(2026, 8, 4, 9, 0, 0),
      'FREQ=DAILY',
    );
    return { result, createdInputs, stateWrites, generatedMarks };
  };

  try {
    const unsafeTemplate = await runDailyRecurrence({
      templateSource: '---\ntags: [template\n',
    });
    assert.equal(unsafeTemplate.result, false);
    assert.equal(unsafeTemplate.createdInputs.length, 0);
    assert.equal(unsafeTemplate.stateWrites, 0, 'unsafe templates fail before recurrence operation state');
    assert.equal(unsafeTemplate.generatedMarks, 0);

    const created = await runDailyRecurrence({
      templateSource: '---\ntags: [template, keep]\n---\n#template remains body content\n',
    });
    assert.equal(created.result, true);
    assert.equal(created.createdInputs.length, 1);
    assert.match(created.createdInputs[0].content, /tags:\s*\[\s*keep\s*\]/u);
    assert.equal(created.createdInputs[0].content.includes('#template remains body content'), true);
    assert.equal(created.generatedMarks, 1);

    const contaminated = await runDailyRecurrence({
      templateSource: '---\ntags: [template, keep]\n---\n',
      outputAfterMutation: '---\ntags: [template, keep]\n---\n',
    });
    assert.equal(contaminated.result, false);
    assert.equal(contaminated.createdInputs.length, 1);
    assert.equal(contaminated.generatedMarks, 0);

    const protectedExisting = await runDailyRecurrence({
      templateSource: '---\ntags: [template, keep]\n---\n',
      existingSource: '---\ntags: [template]\n---\n',
    });
    assert.equal(protectedExisting.result, false);
    assert.equal(protectedExisting.createdInputs.length, 0);
    assert.equal(protectedExisting.stateWrites, 0);
    assert.equal(protectedExisting.generatedMarks, 0);
  } finally {
    globalThis.window = originalWindow;
    globalThis.__TpsReconcileDailyNoteForTemplateTest = originalReconcile;
  }
});
