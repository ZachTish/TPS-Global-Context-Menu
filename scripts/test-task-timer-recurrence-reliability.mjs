import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const timeTrackingSource = readFileSync(
  new URL('../src/services/time-tracking-service.ts', import.meta.url),
  'utf8',
);
const recurrenceServiceSource = readFileSync(
  new URL('../src/services/task-recurrence-service.ts', import.meta.url),
  'utf8',
);
const taskLineContextMenuSource = readFileSync(
  new URL('../src/services/task-line-context-menu-service.ts', import.meta.url),
  'utf8',
);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function importTaskRecurrenceUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/utils/task-recurrence.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

async function importMappedTaskCreationServices() {
  const build = await esbuild.build({
    stdin: {
      contents: `
        export { TaskRecurrenceService } from './src/services/task-recurrence-service.ts';
        export { TimeTrackingService } from './src/services/time-tracking-service.ts';
        export { Notice, TFile } from 'obsidian';
      `,
      resolveDir: repoRoot,
      sourcefile: 'mapped-task-creation-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'mapped-task-creation-obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian',
          namespace: 'mapped-task-creation-obsidian',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'mapped-task-creation-obsidian' }, () => ({
          loader: 'js',
          contents: `
            export class MarkdownView {}
            export class Modal {
              constructor(app) { this.app = app; }
              open() { globalThis.__lastOpenedModal = this; }
              close() {}
            }
            export class Setting {}
            export class Notice {
              static messages = [];
              constructor(message) { Notice.messages.push(String(message)); }
            }
            export class TFile {
              constructor(path) {
                this.path = path;
                this.name = path.split('/').pop() || path;
                this.basename = this.name.replace(/\\.[^.]+$/, '');
                this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
              }
            }
            export function normalizePath(value) {
              return String(value ?? '').trim().replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/');
            }
            export function parseYaml() { return {}; }
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`);
}

function normalizeStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

test('task timers re-resolve the current task before reading or attaching a stable id', () => {
  assert.match(timeTrackingSource, /export interface TimeTrackingTargetInput[\s\S]*?rawLine\?: string;/);
  assert.match(timeTrackingSource, /findCurrentTaskLineIndex\([\s\S]{0,240}preferredLineNumber[\s\S]{0,240}sourceRawLine[\s\S]{0,240}sourceTitle/);
  assert.match(
    timeTrackingSource,
    /private async ensureTaskLineTpsId\([\s\S]{0,1800}vault\.process\([\s\S]{0,900}findCurrentTaskLineIndex\(lines, preferredLineNumber, rawLine, title\)/,
  );
  assert.match(timeTrackingSource, /lineNumber: ensured\.lineNumber/);
  assert.match(timeTrackingSource, /rawLine: target\.rawLine/);
  assert.match(timeTrackingSource, /Task target became stale before stable-id write/);
});

test('recurrence template editing resolves its source atomically and refuses stale targets', () => {
  assert.match(
    recurrenceServiceSource,
    /editTemplateForTaskLine[\s\S]{0,2200}mutateMarkdownBody\(file[\s\S]{0,900}findCurrentTaskLineIndex/,
  );
  assert.match(recurrenceServiceSource, /Template target was stale or ambiguous/);
  assert.match(recurrenceServiceSource, /Could not uniquely find the recurrence template task/);
  assert.doesNotMatch(recurrenceServiceSource, /writeLineByIndex/);
});

test('recurrence clones use the captured mapped status while dropping stale workflow and instance identity', async () => {
  const {
    buildNextTaskRecurrenceLine,
    buildTaskRecurrenceTemplateLine,
    isCompletedTaskMarker,
  } = await importTaskRecurrenceUtility();
  const source = '- [x] Recurring task [workflow:: complete] [recurrence:: FREQ=DAILY] [recurrenceTaskId:: rec-1] [tpsId:: task-1] [subitemId:: sub-1] [completedDate:: 2026-07-14 09:00:00] %% tps-inline-props:{"associatedNotePath":"Tasks/Recurring task.md","externalId":"reminder-1","stableId":"stable-1"} %%';

  const template = buildTaskRecurrenceTemplateLine(source, '[o]', 'workflow');
  assert.match(template, /^- \[o\] Recurring task/);
  assert.match(template, /\[recurrence:: FREQ=DAILY\]/);
  assert.match(template, /\[recurrenceTaskId:: rec-1\]/);
  assert.doesNotMatch(template, /workflow|tpsId|subitemId|completedDate|tps-inline-props|associatedNotePath|externalId|stableId/i);

  const next = buildNextTaskRecurrenceLine(template, '2026-07-15 09:00:00', '[o]', 'workflow');
  assert.match(next, /^- \[o\] Recurring task/);
  assert.match(next, /\[recurrenceTaskId:: rec-1\]/);
  assert.match(next, /\[scheduled:: 2026-07-15 09:00:00\]/);
  assert.doesNotMatch(next, /tpsId|subitemId|completedDate|tps-inline-props|associatedNotePath|externalId|stableId/i);
  assert.throws(
    () => buildTaskRecurrenceTemplateLine(source, '[too-long]', 'workflow'),
    /requires a valid mapped checkbox state/u,
  );
  assert.equal(isCompletedTaskMarker('X', ['x']), true);
  assert.equal(isCompletedTaskMarker('[X]', ['x']), true);
  assert.equal(isCompletedTaskMarker('[XX]', ['x']), false);
});

test('recurrence mapping failure performs zero markdown or template-store writes', async () => {
  const { Notice, TaskRecurrenceService, TFile } = await importMappedTaskCreationServices();
  Notice.messages.length = 0;
  let markdownMutations = 0;
  let templateWrites = 0;
  const plugin = {
    settings: {
      enableRecurrence: true,
      recurrenceDefaultStatus: 'todo',
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[bad]', statuses: ['todo'] },
        { checkboxState: '[x]', statuses: ['complete'] },
      ],
    },
    sharedServices: {
      status: {
        normalize: normalizeStatus,
        getDoneStatuses: () => ['complete'],
        getStatusPropertyKey: () => 'workflow',
      },
    },
    subitemRelationshipSyncService: {
      async mutateMarkdownBody() { markdownMutations += 1; },
    },
    app: {
      vault: {
        adapter: {
          exists: async () => false,
          read: async () => '',
          write: async () => { templateWrites += 1; },
        },
      },
    },
    manifest: { dir: '.obsidian/plugins/tps-global-context-menu' },
  };
  const service = new TaskRecurrenceService(plugin);
  await service.handleTaskCompletion({
    file: new TFile('Inbox/Recurring.md'),
    lineIndex: 0,
    previousState: ' ',
    nextState: 'x',
    updatedLines: ['- [x] Repeat [recurrence:: GCM-AFTER-COMPLETION:P1D]'],
  });

  assert.equal(markdownMutations, 0);
  assert.equal(templateWrites, 0);
  assert.match(Notice.messages.at(-1) || '', /default status has no checkbox mapping/u);
});

test('ordinary task completion skips recurrence mapping validation even when the note contains another recurring task', async () => {
  const { Notice, TaskRecurrenceService, TFile } = await importMappedTaskCreationServices();
  Notice.messages.length = 0;
  let markdownMutations = 0;
  const plugin = {
    settings: {
      enableRecurrence: true,
      recurrenceDefaultStatus: 'todo',
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[bad]', statuses: ['todo'] },
        { checkboxState: '[x]', statuses: ['complete'] },
      ],
    },
    sharedServices: {
      status: {
        normalize: normalizeStatus,
        getDoneStatuses: () => ['complete'],
        getStatusPropertyKey: () => 'workflow',
      },
    },
    subitemRelationshipSyncService: {
      async mutateMarkdownBody() { markdownMutations += 1; },
    },
  };
  const service = new TaskRecurrenceService(plugin);
  await service.handleTaskCompletion({
    file: new TFile('Inbox/Mixed.md'),
    lineIndex: 0,
    previousState: ' ',
    nextState: 'x',
    updatedLines: [
      '- [x] Ordinary task',
      '- [ ] Different recurring task [recurrence:: GCM-AFTER-COMPLETION:P1D]',
    ],
  });

  assert.equal(markdownMutations, 0);
  assert.deepEqual(Notice.messages, []);
});

test('recurrence uses a custom primary marker and removes stale relational status', async () => {
  const { TaskRecurrenceService, TFile } = await importMappedTaskCreationServices();
  const file = new TFile('Inbox/Recurring.md');
  const lines = [
    '- [X] Repeat [workflow:: complete] [recurrence:: GCM-AFTER-COMPLETION:P1D] [recurrenceTaskId:: rec-1]',
  ];
  const plugin = {
    settings: {
      enableRecurrence: true,
      recurrenceDefaultStatus: 'todo',
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[o]', statuses: ['todo'] },
        { checkboxState: '[X]', statuses: ['complete'] },
      ],
    },
    sharedServices: {
      status: {
        normalize: normalizeStatus,
        getDoneStatuses: () => ['complete'],
        getStatusPropertyKey: () => 'workflow',
      },
    },
    subitemRelationshipSyncService: {
      async mutateMarkdownBody(_file, mutate) { await mutate(lines); },
    },
    app: {
      vault: {
        adapter: {
          exists: async () => false,
          read: async () => '',
          write: async () => undefined,
        },
      },
    },
    manifest: { dir: '.obsidian/plugins/tps-global-context-menu' },
    eventService: { emitFilesUpdated() {} },
    overlayRenderingService: { invalidate() {} },
  };
  const service = new TaskRecurrenceService(plugin);
  await service.handleTaskCompletion({
    file,
    lineIndex: 0,
    previousState: ' ',
    nextState: 'X',
    updatedLines: [...lines],
  });

  assert.equal(lines.length, 2);
  assert.match(lines[1], /^- \[o\] Repeat/u);
  assert.doesNotMatch(lines[1], /\[workflow::/u);
});

test('recurrence completion performs zero markdown or template writes when its creation mapping changes at the mutation boundary', async () => {
  const { TaskRecurrenceService, TFile } = await importMappedTaskCreationServices();
  const file = new TFile('Inbox/Recurring.md');
  const originalLine = '- [X] Repeat [workflow:: complete] [recurrence:: GCM-AFTER-COMPLETION:P1D] [recurrenceTaskId:: rec-1]';
  const lines = [originalLine];
  let markdownWrites = 0;
  let templateWrites = 0;
  const plugin = {
    settings: {
      enableRecurrence: true,
      recurrenceDefaultStatus: 'todo',
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[o]', statuses: ['todo'] },
        { checkboxState: '[X]', statuses: ['complete'] },
      ],
    },
    sharedServices: {
      status: {
        normalize: normalizeStatus,
        getDoneStatuses: () => ['complete'],
        getStatusPropertyKey: () => 'workflow',
      },
    },
    subitemRelationshipSyncService: {
      async mutateMarkdownBody(_file, mutate) {
        plugin.settings.linkedSubitemCheckboxMappings = [
          { checkboxState: '[q]', statuses: ['todo'] },
          { checkboxState: '[X]', statuses: ['complete'] },
        ];
        if (await mutate(lines)) markdownWrites += 1;
      },
    },
    app: {
      vault: {
        adapter: {
          exists: async () => false,
          read: async () => '',
          write: async () => { templateWrites += 1; },
        },
      },
    },
    manifest: { dir: '.obsidian/plugins/tps-global-context-menu' },
    eventService: { emitFilesUpdated() {} },
    overlayRenderingService: { invalidate() {} },
  };
  const service = new TaskRecurrenceService(plugin);
  await service.handleTaskCompletion({
    file,
    lineIndex: 0,
    previousState: ' ',
    nextState: 'X',
    updatedLines: [...lines],
  });

  assert.equal(markdownWrites, 0);
  assert.equal(templateWrites, 0);
  assert.deepEqual(lines, [originalLine]);
});

test('both recurrence template modal callbacks perform zero saves after their semantic mapping changes', async () => {
  const { TaskRecurrenceService, TFile } = await importMappedTaskCreationServices();
  const makePlugin = (storedTemplates = null) => {
    let templateWrites = 0;
    const plugin = {
      settings: {
        enableRecurrence: true,
        recurrenceDefaultStatus: 'todo',
        linkedSubitemCheckboxMappings: [
          { checkboxState: '[o]', statuses: ['todo'] },
          { checkboxState: '[X]', statuses: ['complete'] },
        ],
      },
      sharedServices: {
        status: {
          normalize: normalizeStatus,
          getDoneStatuses: () => ['complete'],
          getStatusPropertyKey: () => 'workflow',
        },
      },
      subitemRelationshipSyncService: {
        async mutateMarkdownBody(_file, mutate) {
          await mutate(plugin.lines);
        },
      },
      app: {
        vault: {
          adapter: {
            exists: async () => storedTemplates != null,
            read: async () => JSON.stringify({ version: 1, templates: storedTemplates || {} }),
            write: async () => { templateWrites += 1; },
          },
        },
      },
      manifest: { dir: '.obsidian/plugins/tps-global-context-menu' },
      lines: [],
      get templateWrites() { return templateWrites; },
    };
    return plugin;
  };

  const editPlugin = makePlugin();
  const file = new TFile('Inbox/Recurring.md');
  const rawLine = '- [o] Repeat [recurrence:: GCM-AFTER-COMPLETION:P1D] [recurrenceTaskId:: rec-edit]';
  editPlugin.lines = [rawLine];
  globalThis.__lastOpenedModal = null;
  const editService = new TaskRecurrenceService(editPlugin);
  await editService.editTemplateForTaskLine(file, 0, rawLine);
  const editModal = globalThis.__lastOpenedModal;
  assert.ok(editModal?.onSubmit, 'edit-template modal must open with a guarded save callback');
  editPlugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[q]', statuses: ['todo'] },
    { checkboxState: '[X]', statuses: ['complete'] },
  ];
  await editModal.onSubmit(rawLine);
  assert.equal(editPlugin.templateWrites, 0);

  const storedLine = '- [o] Repeat [recurrence:: GCM-AFTER-COMPLETION:P1D] [recurrenceTaskId:: rec-command]';
  const commandPlugin = makePlugin({
    'rec-command': { line: storedLine, updatedAt: '2026-08-02T00:00:00.000Z' },
  });
  globalThis.window = { prompt: () => '1' };
  globalThis.__lastOpenedModal = null;
  const commandService = new TaskRecurrenceService(commandPlugin);
  await commandService.openTemplatesCommand();
  const commandModal = globalThis.__lastOpenedModal;
  assert.ok(commandModal?.onSubmit, 'template-command modal must open with a guarded save callback');
  commandPlugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[q]', statuses: ['todo'] },
    { checkboxState: '[X]', statuses: ['complete'] },
  ];
  await commandModal.onSubmit(storedLine);
  assert.equal(commandPlugin.templateWrites, 0);
});

test('timer task creation resolves mapping before any Daily Note creation or markdown write', async () => {
  const { Notice, TFile, TimeTrackingService } = await importMappedTaskCreationServices();
  Notice.messages.length = 0;
  let dailyNoteCreates = 0;
  let processCalls = 0;
  const sourceFile = new TFile('Inbox/Timers.md');
  let sourceContent = '# Timers\n';
  const plugin = {
    settings: {
      enableTimeTracking: true,
      linkedSubitemCheckboxMappings: [{ checkboxState: '[bad]', statuses: ['todo'] }],
      autoSyncFileTimestamps: false,
      dateCreatedFrontmatterKey: 'datecreated',
      dateModifiedFrontmatterKey: 'datemodified',
      fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    sharedServices: { status: { normalize: normalizeStatus } },
    app: {
      vault: {
        async process(_file, mutate) {
          processCalls += 1;
          sourceContent = mutate(sourceContent);
        },
        async cachedRead() { return sourceContent; },
      },
      workspace: { getActiveFile: () => null },
      metadataCache: { getFileCache: () => null },
    },
    noteOperationService: {
      async ensureDailyNote() {
        dailyNoteCreates += 1;
        return sourceFile;
      },
    },
  };
  const service = new TimeTrackingService(plugin);

  assert.equal(await service.startTaskTimerForNote('Blocked timer', null, 'daily-note'), null);
  assert.equal(dailyNoteCreates, 0);
  assert.equal(processCalls, 0);
  assert.match(Notice.messages.at(-1) || '', /todo has no checkbox mapping/u);

  plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[o]', statuses: ['todo'] },
    { checkboxState: '[x]', statuses: ['complete'] },
  ];
  service.startTimer = async (input) => input;
  const created = await service.startTaskTimerForNote('Mapped timer', sourceFile, 'source-note');
  assert.ok(created);
  assert.equal(dailyNoteCreates, 0);
  assert.equal(processCalls, 1);
  assert.match(sourceContent, /- \[o\] Mapped timer \[tpsId:: task_/u);
});

test('timer task creation performs zero markdown writes when Todo mapping changes at the process boundary', async () => {
  const { TFile, TimeTrackingService } = await importMappedTaskCreationServices();
  const sourceFile = new TFile('Inbox/Timers.md');
  let sourceContent = '# Timers\n';
  let processCalls = 0;
  let markdownWrites = 0;
  let timerStarts = 0;
  const plugin = {
    settings: {
      enableTimeTracking: true,
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[o]', statuses: ['todo'] },
        { checkboxState: '[x]', statuses: ['complete'] },
      ],
      autoSyncFileTimestamps: false,
      dateCreatedFrontmatterKey: 'datecreated',
      dateModifiedFrontmatterKey: 'datemodified',
      fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    sharedServices: { status: { normalize: normalizeStatus } },
    app: {
      vault: {
        async process(_file, mutate) {
          processCalls += 1;
          plugin.settings.linkedSubitemCheckboxMappings = [
            { checkboxState: '[q]', statuses: ['todo'] },
            { checkboxState: '[x]', statuses: ['complete'] },
          ];
          const next = mutate(sourceContent);
          if (next !== sourceContent) markdownWrites += 1;
          sourceContent = next;
        },
        async cachedRead() { return sourceContent; },
      },
      workspace: { getActiveFile: () => null },
      metadataCache: { getFileCache: () => null },
    },
  };
  const service = new TimeTrackingService(plugin);
  service.startTimer = async () => { timerStarts += 1; return {}; };

  assert.equal(await service.startTaskTimerForNote('Race timer', sourceFile, 'source-note'), null);
  assert.equal(processCalls, 1, 'the CAS must execute inside the atomic updater');
  assert.equal(markdownWrites, 0);
  assert.equal(timerStarts, 0);
  assert.equal(sourceContent, '# Timers\n');
});

async function createTimeTrackingNotesHarness() {
  const { Notice, TFile, TimeTrackingService } = await importMappedTaskCreationServices();
  Notice.messages.length = 0;
  const sourceFile = new TFile('Projects/Alpha.md');
  const scheduledFile = new TFile('Projects/Beta.md');
  const dailyFile = new TFile('Daily/2026-08-03.md');
  const files = new Map([
    [sourceFile.path, sourceFile],
    [scheduledFile.path, scheduledFile],
    [dailyFile.path, dailyFile],
  ]);
  const bodies = new Map([
    [sourceFile.path, '---\ntitle: Alpha\ntpsId: project-alpha\n---\n\n# Alpha\n- [ ] Ship release [tpsId:: task-one]\n'],
    [scheduledFile.path, '---\ntitle: Beta\ntpsId: project-beta\nscheduled: 2026-09-01 09:00:00\ntimeEstimate: 75\nend: 2026-09-01 10:15:00\n---\n\n# Beta\n'],
    [dailyFile.path, '---\ntitle: Today\nscheduled: 2026-08-03 00:00:00\n---\n\n# Existing\n'],
  ]);
  const frontmatter = new Map([
    [sourceFile.path, { title: 'Alpha', tpsId: 'project-alpha' }],
    [scheduledFile.path, {
      title: 'Beta',
      tpsId: 'project-beta',
      scheduled: '2026-09-01 09:00:00',
      timeEstimate: 75,
      end: '2026-09-01 10:15:00',
    }],
    [dailyFile.path, { title: 'Today', scheduled: '2026-08-03 00:00:00' }],
  ]);
  const timingMutationAttempts = [];
  const plugin = {
    settings: {
      enableTimeTracking: true,
      timeTrackingPropertyKey: 'timeTracking',
      timeTrackingStorageMode: 'source-note',
      timeTrackingDailyNoteHeading: 'Time Tracking',
      timeTrackingDailyNotePlacement: 'top',
      timeTrackingSingleActiveSession: false,
      timeTrackingIgnoreArchivedFiles: false,
      timeTrackingPausedSession: null,
    },
    app: {
      vault: {
        getAbstractFileByPath: (path) => files.get(path) ?? null,
        getMarkdownFiles: () => [...files.values()],
        async cachedRead(file) { return bodies.get(file.path) ?? ''; },
        async process(file, mutate) {
          bodies.set(file.path, mutate(bodies.get(file.path) ?? ''));
        },
      },
      metadataCache: {
        getFileCache: (file) => ({ frontmatter: frontmatter.get(file.path) }),
      },
      fileManager: {
        generateMarkdownLink: (file) => `[[${file.path.replace(/\.md$/u, '')}]]`,
      },
      workspace: {
        getActiveFile: () => sourceFile,
      },
    },
    sharedServices: {
      schedule: {
        parseDate: (value) => new Date(String(value).replace(' ', 'T')),
        formatDateTimeForFrontmatter: (date) => date.toISOString().slice(0, 19).replace('T', ' '),
      },
    },
    frontmatterMutationService: {
      async process(file, mutate) {
        const value = frontmatter.get(file.path) ?? {};
        const guarded = new Proxy(value, {
          set(target, key, next) {
            if (['scheduled', 'timeestimate', 'end', 'enddate', 'ends'].includes(String(key).toLowerCase())) {
              timingMutationAttempts.push({ operation: 'set', path: file.path, key: String(key) });
            }
            return Reflect.set(target, key, next);
          },
          deleteProperty(target, key) {
            if (['scheduled', 'timeestimate', 'end', 'enddate', 'ends'].includes(String(key).toLowerCase())) {
              timingMutationAttempts.push({ operation: 'delete', path: file.path, key: String(key) });
            }
            return Reflect.deleteProperty(target, key);
          },
        });
        mutate(guarded);
        frontmatter.set(file.path, value);
      },
    },
    noteOperationService: {
      async ensureDailyNote() { return dailyFile; },
    },
    eventService: { emitFilesUpdated() {} },
    timeTrackingStatusBarService: { refresh() {} },
    async persistRuntimeSettingsState() {},
    getArchiveFolderPath: () => '_archive',
  };
  return {
    Notice,
    bodies,
    dailyFile,
    files,
    frontmatter,
    plugin,
    scheduledFile,
    service: new TimeTrackingService(plugin),
    sourceFile,
    timingMutationAttempts,
  };
}

function readTimingMetadata(frontmatter, file) {
  const value = frontmatter.get(file.path) ?? {};
  return {
    scheduled: value.scheduled,
    timeEstimate: value.timeEstimate,
    end: value.end,
  };
}

test('ordinary note sessions create Daily Note notes without scheduling the note or Daily Note', async () => {
  const {
    bodies,
    dailyFile,
    frontmatter,
    service,
    sourceFile,
    timingMutationAttempts,
  } = await createTimeTrackingNotesHarness();
  const originalDailyScheduled = frontmatter.get(dailyFile.path).scheduled;
  const session = await service.startTimer({ file: sourceFile, type: 'note' });

  assert.ok(session);
  assert.equal(session.targetPath, sourceFile.path);
  assert.equal(session.notesPath, dailyFile.path);
  assert.deepEqual(readTimingMetadata(frontmatter, sourceFile), {
    scheduled: undefined,
    timeEstimate: undefined,
    end: undefined,
  });
  assert.equal(frontmatter.get(dailyFile.path).scheduled, originalDailyScheduled);
  assert.equal(frontmatter.get(dailyFile.path).timeEstimate, undefined);
  assert.match(bodies.get(dailyFile.path), /^---\ntitle: Today\nscheduled: 2026-08-03 00:00:00\n---\n## Time Tracking\n\n### /u);
  assert.match(bodies.get(dailyFile.path), /\^tps-time-tt[_-]/u);
  const stored = frontmatter.get(sourceFile.path).timeTracking;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].notesPath, dailyFile.path);
  assert.equal(stored[0].notesHeading, 'Time Tracking');
  assert.match(stored[0].notesBlockId, /^tps-time-tt[_-]/u);

  const rawTask = '- [ ] Ship release [tpsId:: task-one]';
  const taskLineNumber = bodies.get(sourceFile.path).split(/\r?\n/u).indexOf(rawTask);
  const taskSession = await service.startTimer({
    file: sourceFile,
    type: 'task',
    lineNumber: taskLineNumber,
    rawLine: rawTask,
    title: 'Ship release',
  });
  assert.ok(taskSession);
  assert.equal(taskSession.targetType, 'task');
  assert.equal(taskSession.notesPath, dailyFile.path);
  assert.equal(frontmatter.get(dailyFile.path).scheduled, originalDailyScheduled);
  assert.equal(frontmatter.get(dailyFile.path).timeEstimate, undefined);
  assert.match(bodies.get(sourceFile.path), /Ship release[\s\S]*\[scheduled::/u);
  assert.equal(frontmatter.get(sourceFile.path).timeTracking.length, 2);
  assert.equal((bodies.get(dailyFile.path).match(/\^tps-time-tt[_-]/gu) || []).length, 2);
  assert.deepEqual(timingMutationAttempts, []);
});

test('external task timers can reuse their target without creating notes and stop by exact session id', async () => {
  const { bodies, dailyFile, frontmatter, service, sourceFile } = await createTimeTrackingNotesHarness();
  const dailyBefore = bodies.get(dailyFile.path);
  const lines = bodies.get(sourceFile.path).split(/\r?\n/u);
  const rawTask = '- [ ] Ship release [tpsId:: task-one]';
  const lineNumber = lines.indexOf(rawTask);
  const external = await service.startTimer({
    file: sourceFile,
    type: 'task',
    lineNumber,
    rawLine: rawTask,
    title: 'Workout',
  }, undefined, {
    notesMode: 'none',
    start: '2026-08-03T08:00:00.000Z',
  });
  assert.ok(external);
  assert.equal(external.notesMode, 'none');
  assert.equal(external.notesPath, undefined);
  assert.equal(external.start, '2026-08-03 08:00:00');
  assert.equal(bodies.get(dailyFile.path), dailyBefore, 'no Time Tracking heading or workspace is created');

  const ordinary = await service.startTimer({ file: sourceFile, type: 'note' });
  assert.ok(ordinary);
  const stopped = await service.stopTimerById(external.id, '2026-08-03T08:45:00.000Z');
  assert.equal(stopped?.id, external.id);
  assert.equal(stopped?.end, '2026-08-03 08:45:00');
  const stored = frontmatter.get(sourceFile.path).timeTracking;
  assert.equal(stored.find((record) => record.id === external.id).end, '2026-08-03 08:45:00');
  assert.equal(stored.find((record) => record.id === ordinary.id).end, undefined, 'the unrelated active timer remains running');
});

test('authored note timing survives running, manual, stopped, and periodic session synchronization', async () => {
  const {
    dailyFile,
    frontmatter,
    scheduledFile,
    service,
    timingMutationAttempts,
  } = await createTimeTrackingNotesHarness();
  const authoredTiming = {
    scheduled: '2026-09-01 09:00:00',
    timeEstimate: 75,
    end: '2026-09-01 10:15:00',
  };

  const running = await service.startTimer({ file: scheduledFile, type: 'note' });
  assert.ok(running);
  assert.deepEqual(readTimingMetadata(frontmatter, scheduledFile), authoredTiming);

  await service.syncRunningScheduledMetadata();
  assert.deepEqual(readTimingMetadata(frontmatter, scheduledFile), authoredTiming);

  const manual = await service.addManualSession(
    { file: scheduledFile, type: 'note' },
    '2026-08-03 13:00:00',
    '2026-08-03 13:45:00',
  );
  assert.ok(manual);
  assert.deepEqual(readTimingMetadata(frontmatter, scheduledFile), authoredTiming);

  const stopped = await service.stopActiveTimerForFile(
    scheduledFile,
    new Date(Date.now() + 60_000),
  );
  assert.ok(stopped);
  assert.deepEqual(readTimingMetadata(frontmatter, scheduledFile), authoredTiming);
  assert.equal(frontmatter.get(scheduledFile.path).timeTracking.length, 2);
  assert.equal(frontmatter.get(dailyFile.path).scheduled, '2026-08-03 00:00:00');
  assert.equal(frontmatter.get(dailyFile.path).timeEstimate, undefined);
  assert.deepEqual(timingMutationAttempts, []);
});

test('tracking the Daily Note itself preserves its canonical schedule while adding its session workspace', async () => {
  const {
    bodies,
    dailyFile,
    frontmatter,
    service,
    timingMutationAttempts,
  } = await createTimeTrackingNotesHarness();
  const canonicalSchedule = frontmatter.get(dailyFile.path).scheduled;

  const session = await service.startTimer({ file: dailyFile, type: 'note' });
  assert.ok(session);
  assert.equal(session.targetPath, dailyFile.path);
  assert.equal(session.notesPath, dailyFile.path);
  assert.deepEqual(readTimingMetadata(frontmatter, dailyFile), {
    scheduled: canonicalSchedule,
    timeEstimate: undefined,
    end: undefined,
  });
  assert.equal(frontmatter.get(dailyFile.path).timeTracking.length, 1);
  assert.match(bodies.get(dailyFile.path), /^---\ntitle: Today\nscheduled: 2026-08-03 00:00:00\n---\n## Time Tracking\n\n### /u);
  assert.equal((bodies.get(dailyFile.path).match(/^## Time Tracking$/gmu) || []).length, 1);

  await service.syncRunningScheduledMetadata();
  assert.deepEqual(readTimingMetadata(frontmatter, dailyFile), {
    scheduled: canonicalSchedule,
    timeEstimate: undefined,
    end: undefined,
  });
  assert.deepEqual(timingMutationAttempts, []);
});

test('timer duplicate resolves todo before vault.process and clears stale status metadata', () => {
  const methodStart = taskLineContextMenuSource.indexOf('private async duplicateTaskBelowForTimer');
  const methodEnd = taskLineContextMenuSource.indexOf('private promptTaskTitle', methodStart);
  const methods = taskLineContextMenuSource.slice(methodStart, methodEnd);
  assert.ok(methodStart >= 0 && methodEnd > methodStart);
  assert.ok(
    methods.indexOf("this.resolveTaskCreationCheckboxState('todo')") < methods.indexOf('this.plugin.app.vault.process'),
    'todo mapping must resolve before the duplicate write begins',
  );
  assert.match(methods, /if \(!checkboxState\)[\s\S]{0,500}return null;/u);
  assert.match(methods, /setTaskStatusCheckboxState\(context\.rawLine, checkboxState\)/u);
  assert.match(
    taskLineContextMenuSource,
    /private setTaskStatusCheckboxState[\s\S]{0,260}setTaskCheckboxWorkflowState\([\s\S]{0,180}getTaskWorkflowFieldOwnership/u,
  );
  assert.doesNotMatch(methods, /setTaskStatusCheckboxState\(context\.rawLine, '\[ \]'\)/u);
});
