import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const taskApiSource = readFileSync(new URL('../src/services/task-api-service.ts', import.meta.url), 'utf8');
const pluginApiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const createTaskSource = readFileSync(new URL('../src/services/create-task-service.ts', import.meta.url), 'utf8');
const aiTaskSource = readFileSync(new URL('../src/services/ai-assisted-task-service.ts', import.meta.url), 'utf8');
const bulkEditSource = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');

async function loadTaskApiModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/task-api-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'task-api-obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'task-api-obsidian' }));
        builder.onLoad({ filter: /.*/, namespace: 'task-api-obsidian' }, () => ({
          loader: 'js',
          contents: `
            export class Notice {}
            export function normalizePath(value) {
              const path = String(value ?? '').trim().replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/');
              return path || '/';
            }
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadTaskCheckboxClassificationModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/task-checkbox-classification.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

class ForeignFile {
  constructor(path, extension = 'md') {
    this.path = path;
    this.extension = extension;
    this.name = path.split('/').pop() || path;
    this.basename = this.name.replace(/\.[^.]+$/, '');
  }
}

function createTaskApiFixture(TaskApiService) {
  const taskPath = 'Inbox/Tasks.md';
  const upperPath = 'Inbox/Upper.MD';
  const canonicalTaskFile = new ForeignFile(taskPath);
  const canonicalUpperFile = new ForeignFile(upperPath, 'MD');
  const canonicalBaseFile = new ForeignFile('Inbox/Rows.base', 'base');
  const canonicalFolder = { path: 'Inbox', name: 'Inbox' };
  const files = new Map([
    [taskPath, canonicalTaskFile],
    [upperPath, canonicalUpperFile],
    [canonicalBaseFile.path, canonicalBaseFile],
    [canonicalFolder.path, canonicalFolder],
  ]);
  const contents = new Map([
    [taskPath, [
      '---',
      'title: Tasks',
      '---',
      '',
      '- [ ] Open task',
      '- [/] Working task',
      '- [x] Complete task',
      '',
    ].join('\n')],
    [upperPath, '- [ ] Uppercase extension task\n'],
  ]);
  const reads = [];
  const processes = [];
  const opened = [];
  const checklistMutations = [];
  const mutationTimeline = [];
  const filesUpdated = [];
  const calendarUpdated = [];
  const overlayInvalidations = [];
  let dailyNoteFallbackCalls = 0;
  const vault = {
    getFileByPath(path) {
      return files.get(path) ?? null;
    },
    getMarkdownFiles() {
      return [canonicalTaskFile, canonicalUpperFile];
    },
    async cachedRead(file) {
      reads.push(file);
      return contents.get(file.path) ?? '';
    },
    async read(file) {
      reads.push(file);
      return contents.get(file.path) ?? '';
    },
    async process(file, updater) {
      processes.push(file);
      contents.set(file.path, updater(contents.get(file.path) ?? ''));
    },
  };
  const status = {
    checkboxStateToStatus(marker) {
      return String(marker).toLowerCase() === 'x' ? 'complete' : marker === '/' ? 'working' : 'todo';
    },
    normalize(value) {
      return String(value ?? '').trim().toLowerCase();
    },
    statusToCheckboxState(value) {
      return String(value).toLowerCase() === 'complete' ? 'x' : ' ';
    },
  };
  const plugin = {
    app: {
      vault,
      workspace: { getLeaf: () => ({}) },
    },
    settings: {
      properties: [],
      linkedSubitemCheckboxMappings: [],
      autoSyncFileTimestamps: false,
      dateCreatedFrontmatterKey: 'createdDate',
      dateModifiedFrontmatterKey: 'modifiedDate',
      fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    sharedServices: { status },
    taskCheckboxHandler: {
      async handleExternalChecklistStateMutation(file, previousState, nextState, updatedLines) {
        mutationTimeline.push('checklist-followup');
        checklistMutations.push({
          file,
          previousState,
          nextState,
          updatedLines: [...updatedLines],
        });
      },
    },
    eventService: {
      emitFilesUpdated(paths) {
        mutationTimeline.push('files-updated');
        filesUpdated.push([...paths]);
      },
      emitCalendarRefresh(paths) {
        mutationTimeline.push('calendar-refresh');
        calendarUpdated.push([...paths]);
      },
    },
    overlayRenderingService: {
      invalidate(options) {
        mutationTimeline.push('overlay-invalidated');
        overlayInvalidations.push({ ...options });
      },
    },
    manifest: { id: 'tps-global-context-menu' },
    fileNamingService: { getDailyNoteDateFormat: () => 'YYYY-MM-DD' },
    noteOperationService: {
      async ensureDailyNote() {
        dailyNoteFallbackCalls += 1;
        return canonicalTaskFile;
      },
    },
    async openFileInLeaf(file) {
      opened.push(file);
    },
    findOpenLeafForFile() {
      return null;
    },
  };
  return {
    service: new TaskApiService(plugin),
    taskPath,
    canonicalTaskFile,
    canonicalUpperFile,
    contents,
    reads,
    processes,
    opened,
    plugin,
    checklistMutations,
    mutationTimeline,
    filesUpdated,
    calendarUpdated,
    overlayInvalidations,
    getDailyNoteFallbackCalls: () => dailyNoteFallbackCalls,
  };
}

test('GCM exposes a strategic task API for external agents', () => {
  assert.match(mainSource, /import \{ TaskApiService \} from '\.\/services\/task-api-service';/);
  assert.match(mainSource, /taskApiService: TaskApiService;/);
  assert.match(mainSource, /this\.taskApiService = new TaskApiService\(this\);/);
  assert.match(pluginApiSource, /tasks: plugin\.taskApiService/);

  assert.match(taskApiSource, /readonly version = 1/);
  assert.match(taskApiSource, /async list\(filter: GcmTaskListFilter = \{\}\)/);
  assert.match(taskApiSource, /async get\(ref: GcmTaskRef\)/);
  assert.match(taskApiSource, /async create\(input: GcmTaskCreateInput\)/);
  assert.match(taskApiSource, /async update\(ref: GcmTaskRef, input: GcmTaskUpdateInput\)/);
  assert.match(taskApiSource, /setCheckbox\(ref: GcmTaskRef, checkbox: string\)/);
  assert.match(taskApiSource, /setCompletion\(ref: GcmTaskRef, completed: boolean\)/);
  assert.match(taskApiSource, /setStatus\(ref: GcmTaskRef, status: string\)/);
  assert.match(taskApiSource, /setScheduled\(ref: GcmTaskRef, scheduled: string \| null\)/);
  assert.match(taskApiSource, /setField\(ref: GcmTaskRef, key: string, value: string \| number \| boolean \| null\)/);
  assert.match(taskApiSource, /setFields\(ref: GcmTaskRef, fields: Record<string, string \| number \| boolean \| null \| undefined>\)/);
  assert.match(taskApiSource, /findByField\(key: string, value: string \| string\[\] \| null, filter: GcmTaskListFilter = \{\}\)/);
  assert.match(taskApiSource, /async move\(/);
  assert.match(taskApiSource, /async delete\(ref: GcmTaskRef\)/);
  assert.match(taskApiSource, /async focus\(ref: GcmTaskRef\)/);
});

test('task API uses task-line semantics instead of note semantics', () => {
  assert.match(taskApiSource, /type: 'task-line'/);
  assert.match(taskApiSource, /GcmTaskRef/);
  assert.match(taskApiSource, /line\?: number/);
  assert.match(taskApiSource, /lineNumber\?: number/);
  assert.match(taskApiSource, /rawLine\?: string/);
  assert.match(taskApiSource, /findCurrentTaskLineIndex/);
  assert.match(taskApiSource, /getTaskDisplayTitle/);
  assert.match(taskApiSource, /parseTaskLine/);
  assert.match(taskApiSource, /readInlineFields/);
  assert.match(taskApiSource, /blockLineCount/);
  assert.match(taskApiSource, /extractTaskBlock\(allLines, lineNumber\)/);
  assert.match(taskApiSource, /\[cleanKey\]: value/);
  assert.match(taskApiSource, /return this\.update\(ref, \{ fields: \{ \[cleanKey\]: value \} \}\)/);
  assert.match(taskApiSource, /return this\.list\(\{\s+\.\.\.filter,\s+fields: \{/);
});

test('task API canonicalizes public file inputs without constructor identity checks', () => {
  assert.doesNotMatch(taskApiSource, /instanceof TFile/);
  assert.match(taskApiSource, /import type \{ TFile \} from 'obsidian';/);
  assert.match(taskApiSource, /private resolveMarkdownFile\(value: unknown\): TFile \| null/);
  assert.match(taskApiSource, /const rawPath = getFilePath\(value\)/);
  assert.match(taskApiSource, /this\.plugin\.app\.vault\.getFileByPath\(normalizePath\(rawPath\)\)/);
  assert.match(taskApiSource, /return isMarkdownFileLike\(file\) \? file : null/);
  assert.match(taskApiSource, /typeof file\.path === 'string'/);
  assert.match(taskApiSource, /file\.extension\.toLowerCase\(\) === 'md'/);

  assert.match(taskApiSource, /const targetFile = this\.resolveMarkdownFile\(input\.targetFile\)/);
  assert.match(taskApiSource, /\?\? this\.resolveMarkdownFile\(input\.targetPath\)/);
  assert.match(taskApiSource, /const targetFile = this\.resolveMarkdownFile\(target\.targetFile\)/);
  assert.match(taskApiSource, /\?\? this\.resolveMarkdownFile\(target\.targetPath\)/);
  assert.match(taskApiSource, /const file = this\.resolveMarkdownFile\(ref\.path\)/);
  assert.match(taskApiSource, /\.map\(\(entry\) => this\.resolveMarkdownFile\(entry\)\)/);
  assert.match(taskApiSource, /const rawPrefix = String\(filter\.pathPrefix \|\| ''\)\.trim\(\)/);
  assert.match(taskApiSource, /if \(!rawPrefix\) return files/);
  assert.doesNotMatch(taskApiSource, /normalizePath\(String\(filter\.pathPrefix \|\| ''\)\.trim\(\)\)/);
  assert.match(taskApiSource, /const file = this\.resolveMarkdownFile\(task\.path\)/);

  assert.match(taskApiSource, /hasExplicitTarget \? null : this\.resolveMarkdownFile\(await this\.ensureTodayDailyNote\(\)\)/);
  assert.match(taskApiSource, /hasExplicitTarget \? null : resolved\.file/);
});

test('compiled task API accepts foreign file-like values and keeps empty prefixes unfiltered', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);

  const open = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: false });
  assert.deepEqual(open.map(task => task.title), ['Open task', 'Working task']);

  const all = await fixture.service.list({ files: [{ path: fixture.taskPath }], includeCompleted: true });
  assert.deepEqual(all.map(task => task.title), ['Open task', 'Working task', 'Complete task']);
  assert.equal(fixture.reads.at(-1), fixture.canonicalTaskFile, 'reads must use the canonical vault object');

  const withoutPrefix = await fixture.service.list({ includeCompleted: true });
  assert.deepEqual(
    withoutPrefix.map(task => task.title),
    ['Open task', 'Working task', 'Complete task', 'Uppercase extension task'],
    'an omitted prefix must not become a root-only filter',
  );
  const inboxPrefix = await fixture.service.list({ pathPrefix: 'Inbox/Upper', includeCompleted: true });
  assert.deepEqual(inboxPrefix.map(task => task.title), ['Uppercase extension task']);

  assert.deepEqual(await fixture.service.list({ paths: ['Inbox/Rows.base'] }), []);
  assert.deepEqual(await fixture.service.list({ paths: ['Inbox'] }), []);
  assert.deepEqual(await fixture.service.list({ paths: ['Inbox/Missing.md'] }), []);

  const exact = await fixture.service.get({
    path: fixture.taskPath,
    lineNumber: all[0].lineNumber,
    rawLine: all[0].rawLine,
    title: all[0].title,
  });
  assert.equal(exact?.title, 'Open task');

  assert.equal(await fixture.service.focus(exact), true);
  assert.equal(fixture.opened.at(-1), fixture.canonicalTaskFile, 'focus must open the canonical vault object');
});

test('compiled task API fails explicit invalid targets closed and writes valid foreign targets exactly', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);

  const missingCreate = await fixture.service.create({ title: 'Must not redirect', targetFile: { path: 'Missing.md' }, notice: false });
  assert.equal(missingCreate.ok, false);
  assert.equal(fixture.getDailyNoteFallbackCalls(), 0, 'an explicit invalid target must not invoke the Daily Note fallback');
  assert.equal(fixture.processes.length, 0);

  const created = await fixture.service.create({ title: 'Created exactly', targetFile: { path: fixture.taskPath }, notice: false });
  assert.equal(created.ok, true);
  assert.equal(fixture.processes.at(-1), fixture.canonicalTaskFile);
  assert.match(fixture.contents.get(fixture.taskPath), /- \[ \] Created exactly/);

  const source = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const move = await fixture.service.move(source[0], { targetFile: { path: 'Inbox/Rows.base' } });
  assert.equal(move.ok, false);
  assert.match(move.error, /Target markdown file/);
});

test('setCompletion uses configured mappings and runs the canonical checklist follow-up before invalidation', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[*]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  ];

  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const completed = await fixture.service.setCompletion(openTask, true);

  assert.equal(completed.ok, true);
  assert.equal(completed.changed, true);
  assert.equal(completed.task?.marker, '*');
  assert.equal(completed.task?.status, 'complete');
  assert.equal(completed.task?.isComplete, true);
  assert.match(completed.task?.rawLine || '', /\[completedDate:: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]/);
  assert.equal(fixture.checklistMutations.length, 1);
  assert.equal(fixture.checklistMutations[0].file, fixture.canonicalTaskFile);
  assert.equal(fixture.checklistMutations[0].previousState, ' ');
  assert.equal(fixture.checklistMutations[0].nextState, '*');
  assert.match(fixture.checklistMutations[0].updatedLines[4], /^- \[\*\] Open task/);
  assert.deepEqual(fixture.mutationTimeline, [
    'checklist-followup',
    'files-updated',
    'calendar-refresh',
    'overlay-invalidated',
  ]);
  assert.deepEqual(fixture.filesUpdated, [[fixture.taskPath]]);
  assert.deepEqual(fixture.calendarUpdated, [[fixture.taskPath]]);
  assert.equal(fixture.overlayInvalidations.length, 1);

  fixture.mutationTimeline.length = 0;
  const unchanged = await fixture.service.setCompletion(completed.task, true);
  assert.equal(unchanged.ok, true);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.task?.isComplete, true);
  assert.equal(fixture.checklistMutations.length, 1);
  assert.deepEqual(fixture.mutationTimeline, []);

  fixture.mutationTimeline.length = 0;
  const reopened = await fixture.service.setCompletion(completed.task, false);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.changed, true);
  assert.equal(reopened.task?.marker, '?');
  assert.equal(reopened.task?.status, 'todo');
  assert.equal(reopened.task?.isComplete, false);
  assert.doesNotMatch(reopened.task?.rawLine || '', /\[completedDate::/);
  assert.equal(fixture.checklistMutations.length, 2);
  assert.equal(fixture.checklistMutations[1].previousState, '*');
  assert.equal(fixture.checklistMutations[1].nextState, '?');
  assert.deepEqual(fixture.mutationTimeline, [
    'checklist-followup',
    'files-updated',
    'calendar-refresh',
    'overlay-invalidated',
  ]);
});

test('setCompletion preserves matching custom states and only canonicalizes explicit opposite targets', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[*]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'complete' },
    { checkboxState: '[/]', statuses: ['working'], toggleTargetStatus: 'complete' },
    { checkboxState: '[-]', statuses: ['wont-do'], toggleTargetStatus: 'todo' },
    { checkboxState: '[>]', statuses: ['migrated'], toggleTargetStatus: 'todo' },
  ];
  fixture.contents.set(
    fixture.taskPath,
    `${fixture.contents.get(fixture.taskPath).trimEnd()}\n- [-] Wont-do task\n- [>] Migrated task\n`,
  );

  const tasks = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const byTitle = new Map(tasks.map((task) => [task.title, task]));
  const working = byTitle.get('Working task');
  const wontDo = byTitle.get('Wont-do task');
  const migrated = byTitle.get('Migrated task');
  assert.ok(working && wontDo && migrated);

  const stillWorking = await fixture.service.setCompletion(working, false);
  const stillWontDo = await fixture.service.setCompletion(wontDo, true);
  const stillMigrated = await fixture.service.setCompletion(migrated, false);
  assert.deepEqual(
    [stillWorking, stillWontDo, stillMigrated].map((result) => ({
      ok: result.ok,
      changed: result.changed,
      marker: result.task?.marker,
    })),
    [
      { ok: true, changed: false, marker: '/' },
      { ok: true, changed: false, marker: '-' },
      { ok: true, changed: false, marker: '>' },
    ],
  );
  assert.equal(fixture.checklistMutations.length, 0);
  assert.deepEqual(fixture.mutationTimeline, []);

  const completedWorking = await fixture.service.setCompletion(working, true);
  const reopenedWontDo = await fixture.service.setCompletion(wontDo, false);
  const completedMigrated = await fixture.service.setCompletion(migrated, true);
  assert.deepEqual(
    [completedWorking, reopenedWontDo, completedMigrated].map((result) => ({
      ok: result.ok,
      changed: result.changed,
      marker: result.task?.marker,
      status: result.task?.status,
    })),
    [
      { ok: true, changed: true, marker: '*', status: 'complete' },
      { ok: true, changed: true, marker: '?', status: 'todo' },
      { ok: true, changed: true, marker: '*', status: 'complete' },
    ],
  );
  assert.deepEqual(
    fixture.checklistMutations.map(({ previousState, nextState }) => [previousState, nextState]),
    [['/', '*'], ['-', '?'], ['>', '*']],
  );
});

test('configured task-state classification keeps custom open states open and migrated records inactive', async () => {
  const {
    classifyMappedTaskCheckboxState,
    hasOpenMappedTaskLines,
  } = await loadTaskCheckboxClassificationModule();
  const mappings = [
    { checkboxState: '[*]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'complete' },
    { checkboxState: '[/]', statuses: ['working'], toggleTargetStatus: 'complete' },
    { checkboxState: '[-]', statuses: ['wont-do'], toggleTargetStatus: 'todo' },
    { checkboxState: '[>]', statuses: ['migrated'], toggleTargetStatus: 'todo' },
  ];

  assert.deepEqual(classifyMappedTaskCheckboxState(mappings, '[?]'), {
    marker: '?',
    status: 'todo',
    isComplete: false,
    isMigrated: false,
    isOpen: true,
  });
  assert.equal(classifyMappedTaskCheckboxState(mappings, '*').isComplete, true);
  assert.equal(classifyMappedTaskCheckboxState(mappings, '/').isOpen, true);
  assert.equal(classifyMappedTaskCheckboxState(mappings, '-').isComplete, true);
  assert.deepEqual(classifyMappedTaskCheckboxState(mappings, '>'), {
    marker: '>',
    status: 'migrated',
    isComplete: false,
    isMigrated: true,
    isOpen: false,
  });

  assert.equal(hasOpenMappedTaskLines(['- [?] Custom todo'], mappings), true);
  assert.equal(hasOpenMappedTaskLines(['- [/] Working'], mappings), true);
  assert.equal(hasOpenMappedTaskLines(['- [*] Complete', '- [-] Wont do', '- [>] Migrated'], mappings), false);
  assert.equal(
    hasOpenMappedTaskLines(['- [*] Complete', '- [>] Migrated', '- [?] Reopened'], mappings),
    true,
    'the checklist property must remain true after reopening into a custom todo marker',
  );
});

test('setCompletion returns the exact post-follow-up task and fails an ambiguous recurrence reopen closed', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[*]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  ];
  fixture.plugin.taskCheckboxHandler.handleExternalChecklistStateMutation = async (
    file,
    previousState,
    nextState,
    updatedLines,
  ) => {
    fixture.mutationTimeline.push('checklist-followup');
    fixture.checklistMutations.push({ file, previousState, nextState, updatedLines: [...updatedLines] });
    if (nextState !== '*') return;
    const lines = fixture.contents.get(fixture.taskPath).split('\n');
    lines[4] = `${lines[4]} [recurrenceTaskId:: qa-series]`;
    lines.splice(5, 0, '- [?] Open task [recurrenceTaskId:: qa-series]');
    fixture.contents.set(fixture.taskPath, lines.join('\n'));
  };

  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const completed = await fixture.service.setCompletion(openTask, true);

  assert.equal(completed.ok, true);
  assert.match(completed.task?.rawLine || '', /\[recurrenceTaskId:: qa-series\]/u);
  assert.equal(completed.task?.lineNumber, 4);
  assert.equal(completed.task?.status, 'complete');

  const reopened = await fixture.service.setCompletion(completed.task, false);
  assert.equal(reopened.ok, true);
  assert.equal(reopened.changed, true);
  assert.equal(
    reopened.task,
    null,
    'reopening creates two identical recurrence rows, so the API must not trust the old absolute line',
  );
  const reopenedLines = fixture.contents.get(fixture.taskPath).split('\n').filter(
    (line) => /^- \[\?\] Open task \[recurrenceTaskId:: qa-series\]$/u.test(line),
  );
  assert.equal(reopenedLines.length, 2);
});

test('setCompletion reports a committed write when follow-up fails and refreshes across frontmatter shifts', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[*]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  ];
  fixture.plugin.taskCheckboxHandler.handleExternalChecklistStateMutation = async () => {
    fixture.mutationTimeline.push('checklist-followup');
    const lines = fixture.contents.get(fixture.taskPath).split('\n');
    lines.splice(2, 0, 'followupAttempted: true');
    fixture.contents.set(fixture.taskPath, lines.join('\n'));
    throw new Error('synthetic follow-up failure');
  };

  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const completed = await fixture.service.setCompletion(openTask, true);

  assert.equal(completed.ok, false);
  assert.equal(completed.changed, true);
  assert.match(completed.error || '', /synthetic follow-up failure/u);
  assert.equal(completed.task?.marker, '*');
  assert.equal(completed.task?.lineNumber, 5, 'frontmatter growth must not leave the result on the old absolute line');
  assert.match(fixture.contents.get(fixture.taskPath).split('\n')[5], /^- \[\*\] Open task/u);
  assert.deepEqual(fixture.mutationTimeline, [
    'checklist-followup',
    'files-updated',
    'calendar-refresh',
    'overlay-invalidated',
  ]);
  assert.deepEqual(fixture.filesUpdated, [[fixture.taskPath]]);
  assert.deepEqual(fixture.calendarUpdated, [[fixture.taskPath]]);
  assert.equal(fixture.overlayInvalidations.length, 1);
});

test('setCompletion fails the refreshed task identity closed when follow-up creates an exact duplicate', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[*]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  ];
  fixture.plugin.taskCheckboxHandler.handleExternalChecklistStateMutation = async () => {
    fixture.mutationTimeline.push('checklist-followup');
    const lines = fixture.contents.get(fixture.taskPath).split('\n');
    lines.splice(5, 0, lines[4]);
    fixture.contents.set(fixture.taskPath, lines.join('\n'));
  };

  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const completed = await fixture.service.setCompletion(openTask, true);

  assert.equal(completed.ok, true);
  assert.equal(completed.changed, true);
  assert.equal(completed.task, null, 'duplicate post-follow-up identities must not select by stale line number');
  assert.deepEqual(fixture.mutationTimeline, [
    'checklist-followup',
    'files-updated',
    'calendar-refresh',
    'overlay-invalidated',
  ]);
});

test('setCompletion never returns a stale task when follow-up removes the exact task line', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.taskCheckboxHandler.handleExternalChecklistStateMutation = async () => {
    fixture.mutationTimeline.push('checklist-followup');
    const lines = fixture.contents.get(fixture.taskPath).split('\n');
    lines[4] = '- Follow-up replaced the task with a bullet';
    fixture.contents.set(fixture.taskPath, lines.join('\n'));
  };

  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const completed = await fixture.service.setCompletion(openTask, true);

  assert.equal(completed.ok, true);
  assert.equal(completed.changed, true);
  assert.equal(completed.task, null);
  assert.deepEqual(fixture.mutationTimeline, [
    'checklist-followup',
    'files-updated',
    'calendar-refresh',
    'overlay-invalidated',
  ]);
});

test('raw setCheckbox remains backward-compatible and does not opt into completion follow-ups', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });

  const result = await fixture.service.setCheckbox(openTask, 'x');

  assert.equal(result.ok, true);
  assert.equal(result.task?.isComplete, true);
  assert.equal(fixture.checklistMutations.length, 0);
  assert.deepEqual(fixture.mutationTimeline, ['files-updated', 'calendar-refresh', 'overlay-invalidated']);
});

test('task API mutations preserve safe task-specific behavior', () => {
  assert.match(taskApiSource, /this\.plugin\.app\.vault\.process\(targetFile/);
  assert.match(taskApiSource, /this\.plugin\.app\.vault\.process\(resolved\.file/);
  assert.match(taskApiSource, /insertLineAfterFrontmatter\(content, line\)/);
  assert.match(taskApiSource, /insertTaskBlockAfterFrontmatter\(content, block\.lines\)/);
  assert.match(taskApiSource, /removeTaskBlockFromContent\(content, sourceIndex, resolved\.record\.rawLine, resolved\.record\.title\)/);
  assert.ok(taskApiSource.includes('setTaskCheckboxToken(next, `[${marker}]`)'));
  assert.ok(taskApiSource.includes('updateTaskCompletedDateForCheckboxState(next, `[${marker}]`'));
  assert.match(taskApiSource, /setInlineFieldValueOnTaskLine\(next, 'status', null\)/);
  assert.match(taskApiSource, /statusToCheckboxMarker\(status: string\)/);
  assert.match(taskApiSource, /linkedSubitemCheckboxMappings/);
  assert.match(taskApiSource, /handleExternalChecklistStateMutation\(/);
  assert.match(taskApiSource, /emitFilesUpdated/);
  assert.match(taskApiSource, /emitCalendarRefresh/);
  assert.match(taskApiSource, /refreshLivePreviewEditors: true/);
});

test('task focus and create flows use the shared focused-tab opener', () => {
  const focusSource = taskApiSource.slice(
    taskApiSource.indexOf('private async focusTask'),
    taskApiSource.indexOf('private notifyChanged'),
  );
  assert.match(focusSource, /this\.plugin\.openFileInLeaf\(file, false/);
  assert.match(focusSource, /this\.plugin\.findOpenLeafForFile\(file\)/);
  assert.doesNotMatch(focusSource, /getLeaf\(false\)\.openFile/);
  assert.doesNotMatch(focusSource, /const leaf = this\.plugin\.app\.workspace\.getLeaf\(false\)/);

  const createFocusSource = createTaskSource.slice(
    createTaskSource.indexOf('private async focusLineBeforeInsertedTask'),
    createTaskSource.indexOf('private getDailyNotesFolder'),
  );
  assert.match(createFocusSource, /this\.plugin\.openFileInLeaf\(file, false/);
  assert.match(createFocusSource, /this\.plugin\.findOpenLeafForFile\(file\)/);
  assert.doesNotMatch(createFocusSource, /getLeaf\(false\)\.openFile/);

  assert.match(aiTaskSource, /this\.plugin\.openFileInLeaf\(targetFile, false/);
  assert.doesNotMatch(aiTaskSource, /getLeaf\(false\)\.openFile\(targetFile/);
});

test('task API and bulk edit mutations emit high-level cause/result logs', () => {
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'create:start'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'create:done'/);
  assert.match(taskApiSource, /logger\.flowError\('TaskApi', 'create:failed'/);
  assert.match(taskApiSource, /logger\.flowWarn\('TaskApi', 'update:target-unresolved'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'update:start'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'update:done'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'move:start'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'move:done'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'delete:start'/);
  assert.match(taskApiSource, /logger\.flow\('TaskApi', 'delete:done'/);
  assert.match(taskApiSource, /private summarizeRef\(ref: GcmTaskRef\): Record<string, unknown>/);

  assert.match(bulkEditSource, /logger\.flow\('BulkEdit', 'apply:start'/);
  assert.match(bulkEditSource, /logger\.flow\('BulkEdit', 'apply:done'/);
  assert.match(bulkEditSource, /logger\.flowError\('BulkEdit', 'apply:file-failed'/);
  assert.match(bulkEditSource, /logger\.flow\('BulkEdit', 'frontmatter:update-start'/);
  assert.match(bulkEditSource, /logger\.flowWarn\('BulkEdit', 'frontmatter:blocked-protected-keys'/);
  assert.match(bulkEditSource, /logger\.flow\('BulkEdit', 'frontmatter:update-canceled'/);
  assert.match(bulkEditSource, /logger\.flow\('BulkEdit', 'frontmatter:update-done'/);
});
