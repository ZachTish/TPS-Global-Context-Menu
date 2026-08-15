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
            export class TFile {}
            export function normalizePath(value) {
              const path = String(value ?? '').trim().replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/');
              return path || '/';
            }
            export function moment(value) {
              const text = String(value ?? '').trim();
              const valid = /^\\d{4}-\\d{2}-\\d{2}$/.test(text);
              return {
                isValid: () => valid,
                format: () => text,
              };
            }
            moment.ISO_8601 = Symbol('ISO_8601');
            moment.invalid = () => ({ isValid: () => false, format: () => '' });
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
  const dailyTaskPath = 'Inbox/Daily/2026-08-10.md';
  const canonicalDailyTaskFile = new ForeignFile(dailyTaskPath);
  const canonicalUpperFile = new ForeignFile(upperPath, 'MD');
  const canonicalBaseFile = new ForeignFile('Inbox/Rows.base', 'base');
  const canonicalFolder = { path: 'Inbox', name: 'Inbox' };
  const files = new Map([
    [taskPath, canonicalTaskFile],
    [dailyTaskPath, canonicalDailyTaskFile],
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
    [dailyTaskPath, [
      '---',
      'title: Daily',
      '---',
      '',
      '- [ ] Daily task [scheduled:: 2026-08-10 09:00:00] [tpsId:: task_daily]',
      '  - [ ] supporting detail [subitemId:: child_daily]',
      '',
    ].join('\n')],
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
    getDoneStatuses() {
      return ['complete', 'wont-do'];
    },
    getStatusPropertyKey() {
      return 'status';
    },
    getRelationalStatusPropertyKey() {
      return '';
    },
    statusToCheckboxState(value) {
      return String(value).toLowerCase() === 'complete' ? 'x' : ' ';
    },
  };
  const plugin = {
    app: {
      vault,
      workspace: { getLeaf: () => ({}) },
      internalPlugins: {
        plugins: {
          'daily-notes': {
            instance: {
              options: {
                folder: 'Inbox/Daily',
                format: 'YYYY-MM-DD',
              },
            },
          },
        },
      },
    },
    settings: {
      properties: [],
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete' },
        { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo' },
        { checkboxState: '[/]', statuses: ['working'], toggleTargetStatus: 'complete' },
        { checkboxState: '[\\]', statuses: ['working'], toggleTargetStatus: 'complete' },
        { checkboxState: '[?]', statuses: ['holding'], toggleTargetStatus: 'todo' },
        { checkboxState: '[-]', statuses: ['wont-do'], toggleTargetStatus: 'todo' },
        { checkboxState: '[>]', statuses: ['migrated'] },
      ],
      autoSyncFileTimestamps: false,
      dailyNoteTaskMoveSourceBehavior: 'mark-migrated',
      dateCreatedFrontmatterKey: 'createdDate',
      dateModifiedFrontmatterKey: 'modifiedDate',
      fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    sharedServices: { status },
    taskCheckboxHandler: {
      async handleExternalChecklistStateMutation(file, previousState, nextState, updatedLines, lineIndex) {
        mutationTimeline.push('checklist-followup');
        checklistMutations.push({
          file,
          previousState,
          nextState,
          updatedLines: [...updatedLines],
          lineIndex,
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
    fileNamingService: {
      getDailyNoteDateFormat: () => 'YYYY-MM-DD',
      isDailyNoteFile: (file) => file?.path === dailyTaskPath,
    },
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
    dailyTaskPath,
    canonicalTaskFile,
    canonicalDailyTaskFile,
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

function installHistoryRecorder(fixture, overrides = {}) {
  const calls = { begin: [], ensure: [], commit: [], abort: [] };
  let sequence = 0;
  fixture.plugin.itemHistoryService = {
    async beginTaskMutation(input) {
      calls.begin.push(structuredClone(input));
      if (overrides.beginError) throw overrides.beginError;
      sequence += 1;
      return { operationId: `op_${sequence}`, entityId: `history_${sequence}` };
    },
    ensureTaskIdentity(handle, line) {
      calls.ensure.push({ handle: { ...handle }, line });
      if (overrides.ensureError) throw overrides.ensureError;
      if (/\[(?:tpsId|subitemId)::/iu.test(line)) return line;
      return `${line} [tpsId:: ${handle.entityId}]`;
    },
    async commitTaskMutation(handle, input) {
      calls.commit.push({ handle: { ...handle }, input: structuredClone(input) });
      if (overrides.commitError) throw overrides.commitError;
    },
    async abortTaskMutation(handle) {
      calls.abort.push({ ...handle });
      if (overrides.abortError) throw overrides.abortError;
    },
  };
  return calls;
}

function moveTaskIntoFenceBeforeNextSourceProcess(fixture, task) {
  const vault = fixture.plugin.app.vault;
  const process = vault.process.bind(vault);
  const protectedContent = ['```md', task.rawLine, '```'].join('\n');
  let armed = true;
  vault.process = async (file, updater) => {
    if (armed && file.path === task.path) {
      armed = false;
      fixture.contents.set(task.path, protectedContent);
    }
    return process(file, updater);
  };
  return protectedContent;
}

test('GCM exposes a strategic task API for external agents', () => {
  assert.match(mainSource, /import \{ TaskApiService \} from '\.\/services\/task-api-service';/);
  assert.match(mainSource, /taskApiService: TaskApiService;/);
  assert.match(mainSource, /this\.taskApiService = new TaskApiService\(this\);/);
  assert.match(pluginApiSource, /tasks: plugin\.taskApiService/);
  assert.match(pluginApiSource, /history: \{/);
  assert.match(pluginApiSource, /plugin\.itemHistoryService\.query\(reference, options\)/);

  assert.match(taskApiSource, /readonly version = 3/);
  assert.match(taskApiSource, /async list\(filter: GcmTaskListFilter = \{\}\)/);
  assert.match(taskApiSource, /async get\(ref: GcmTaskRef\)/);
  assert.match(taskApiSource, /async create\(input: GcmTaskCreateInput, cause\?: ItemHistoryUserCause\)/);
  assert.match(taskApiSource, /async update\([\s\S]{0,160}cause\?: ItemHistoryUserCause/);
  assert.match(taskApiSource, /setCheckbox\(ref: GcmTaskRef, checkbox: string, cause\?: ItemHistoryUserCause\)/);
  assert.match(taskApiSource, /setCompletion\(ref: GcmTaskRef, completed: boolean, cause\?: ItemHistoryUserCause\)/);
  assert.match(taskApiSource, /setStatus\(ref: GcmTaskRef, status: string, cause\?: ItemHistoryUserCause\)/);
  assert.match(taskApiSource, /setScheduled\(ref: GcmTaskRef, scheduled: string \| null, cause\?: ItemHistoryUserCause\)/);
  assert.match(taskApiSource, /setField\([\s\S]{0,220}cause\?: ItemHistoryUserCause/);
  assert.match(taskApiSource, /setFields\([\s\S]{0,220}cause\?: ItemHistoryUserCause/);
  assert.match(taskApiSource, /findByField\(key: string, value: string \| string\[\] \| null, filter: GcmTaskListFilter = \{\}\)/);
  assert.match(taskApiSource, /async move\(/);
  assert.match(taskApiSource, /async delete\(ref: GcmTaskRef, cause\?: ItemHistoryUserCause\)/);
  assert.match(taskApiSource, /async focus\(ref: GcmTaskRef\)/);
});

test('task API v3 journals only explicit user mutations and injects identity atomically', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const history = installHistoryRecorder(fixture);
  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const cause = {
    kind: 'user',
    sourcePluginId: 'tps-controller',
    surface: 'reminder-modal',
  };

  const updated = await fixture.service.setField(openTask, 'priority', 'high', cause);

  assert.equal(updated.ok, true);
  assert.match(updated.task?.rawLine || '', /\[priority:: high\]/u);
  assert.match(updated.task?.rawLine || '', /\[tpsId:: history_1\]/u);
  assert.equal(history.begin.length, 1);
  assert.equal(history.begin[0].action, 'task.update');
  assert.deepEqual(history.begin[0].cause, cause);
  assert.equal(history.commit.length, 1);
  assert.equal(history.commit[0].input.confirmedBefore.rawLine, openTask.rawLine);
  assert.equal(history.commit[0].input.outcome, 'committed');
  assert.match(history.commit[0].input.after.rawLine, /\[tpsId:: history_1\]/u);
  assert.equal(history.abort.length, 0);

  const repeated = await fixture.service.setCompletion(updated.task, false, cause);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.changed, false);
  assert.equal(history.commit.length, 1);
  assert.equal(history.abort.length, 1);

  const unjournaledFixture = createTaskApiFixture(TaskApiService);
  const unjournaledHistory = installHistoryRecorder(unjournaledFixture);
  const [unjournaledTask] = await unjournaledFixture.service.list({
    paths: [unjournaledFixture.taskPath],
    includeCompleted: true,
  });
  const unjournaled = await unjournaledFixture.service.setField(unjournaledTask, 'priority', 'high');
  assert.equal(unjournaled.ok, true);
  assert.doesNotMatch(unjournaled.task?.rawLine || '', /\[tpsId::/u);
  assert.equal(unjournaledHistory.begin.length, 0);
  assert.equal(unjournaledHistory.commit.length, 0);
});

test('task API confirms the live pre-mutation snapshot after stable-identity drift', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.contents.set(
    fixture.taskPath,
    fixture.contents.get(fixture.taskPath).replace(
      '- [ ] Open task',
      '- [ ] Open task [priority:: low] [tpsId:: item_live_drift]',
    ),
  );
  const history = installHistoryRecorder(fixture);
  const [task] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let drifted = false;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (!drifted && file.path === fixture.taskPath) {
      drifted = true;
      fixture.contents.set(
        file.path,
        fixture.contents.get(file.path).replace('[priority:: low]', '[priority:: high]'),
      );
    }
    return process(file, updater);
  };

  const result = await fixture.service.setStatus(task, 'working', {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'task-line-context-menu',
  });

  assert.equal(result.ok, true);
  assert.equal(history.commit.length, 1);
  assert.match(history.commit[0].input.confirmedBefore.rawLine, /priority:: high/u);
  assert.doesNotMatch(history.commit[0].input.confirmedBefore.rawLine, /priority:: low/u);
  assert.equal(
    history.commit[0].input.confirmedBefore.lineNumber,
    history.commit[0].input.after.lineNumber,
  );
});

test('task API history attributes create, update, and same-file move to the exact atomic write', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const cause = {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'task-line-context-menu',
  };
  const armExternalRefreshMutation = (fixture) => {
    const vault = fixture.plugin.app.vault;
    const process = vault.process.bind(vault);
    const cachedRead = vault.cachedRead.bind(vault);
    let armed = false;
    vault.process = async (file, updater) => {
      const result = await process(file, updater);
      armed = true;
      return result;
    };
    vault.cachedRead = async (file) => {
      if (armed) {
        armed = false;
        fixture.contents.set(
          file.path,
          fixture.contents.get(file.path).replace(
            /^(.*\[tpsId:: history_1\].*)$/mu,
            '$1 [priority:: external-refresh]',
          ),
        );
      }
      return cachedRead(file);
    };
  };

  const createFixture = createTaskApiFixture(TaskApiService);
  const createHistory = installHistoryRecorder(createFixture);
  armExternalRefreshMutation(createFixture);
  const created = await createFixture.service.create({
    title: 'Atomic create history',
    targetPath: createFixture.taskPath,
    notice: false,
  }, cause);
  assert.equal(created.ok, true);
  assert.match(created.task?.rawLine || '', /priority:: external-refresh/u);
  assert.doesNotMatch(createHistory.commit[0].input.after.rawLine, /priority:: external-refresh/u);
  assert.match(createHistory.commit[0].input.after.rawLine, /tpsId:: history_1/u);

  const updateFixture = createTaskApiFixture(TaskApiService);
  const [updateTask] = await updateFixture.service.list({ paths: [updateFixture.taskPath], includeCompleted: true });
  const updateHistory = installHistoryRecorder(updateFixture);
  armExternalRefreshMutation(updateFixture);
  const updated = await updateFixture.service.setStatus(updateTask, 'working', cause);
  assert.equal(updated.ok, true);
  assert.match(updated.task?.rawLine || '', /priority:: external-refresh/u);
  assert.doesNotMatch(updateHistory.commit[0].input.after.rawLine, /priority:: external-refresh/u);
  assert.match(updateHistory.commit[0].input.after.rawLine, /^- \[\/\] Open task/u);

  const moveFixture = createTaskApiFixture(TaskApiService);
  const moveTasks = await moveFixture.service.list({ paths: [moveFixture.taskPath], includeCompleted: true });
  const moveTask = moveTasks.find((task) => task.title === 'Working task');
  const moveHistory = installHistoryRecorder(moveFixture);
  armExternalRefreshMutation(moveFixture);
  const moved = await moveFixture.service.move(moveTask, {
    targetPath: moveFixture.taskPath,
    placement: 'after-frontmatter',
  }, cause);
  assert.equal(moved.ok, true);
  assert.match(moved.task?.rawLine || '', /priority:: external-refresh/u);
  assert.doesNotMatch(moveHistory.commit[0].input.after.rawLine, /priority:: external-refresh/u);
  assert.equal(moveHistory.commit[0].input.after.lineNumber, 3);
});

test('task API history uses the exact confirmed post-checklist-follow-up task state', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const history = installHistoryRecorder(fixture);
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[*]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  ];
  fixture.contents.set(
    fixture.taskPath,
    fixture.contents.get(fixture.taskPath).replace('- [ ] Open task', '- [?] Open task'),
  );
  fixture.plugin.taskCheckboxHandler.handleExternalChecklistStateMutation = async () => {
    const lines = fixture.contents.get(fixture.taskPath).split('\n');
    lines.splice(2, 0, 'followupConfirmed: true');
    lines[5] = `${lines[5]} [priority:: followup-confirmed]`;
    fixture.contents.set(fixture.taskPath, lines.join('\n'));
  };
  const [task] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });

  const result = await fixture.service.setCompletion(task, true, {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'linked-context-checkbox',
  });

  assert.equal(result.ok, true);
  assert.match(result.task?.rawLine || '', /priority:: followup-confirmed/u);
  assert.match(history.commit[0].input.after.rawLine, /priority:: followup-confirmed/u);
  assert.equal(history.commit[0].input.after.lineNumber, 5);
});

test('task API history failures remain fail-open and clear unusable pending intents', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const history = installHistoryRecorder(fixture, { ensureError: new Error('history identity unavailable') });
  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });

  const result = await fixture.service.setField(openTask, 'priority', 'high', {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'task-line-context-menu',
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.match(result.task?.rawLine || '', /\[priority:: high\]/u);
  assert.doesNotMatch(result.task?.rawLine || '', /\[tpsId::/u);
  assert.equal(history.commit.length, 0);
  assert.equal(history.abort.length, 1);

  const commitFixture = createTaskApiFixture(TaskApiService);
  const commitHistory = installHistoryRecorder(commitFixture, { commitError: new Error('history commit unavailable') });
  const [commitTask] = await commitFixture.service.list({
    paths: [commitFixture.taskPath],
    includeCompleted: true,
  });
  const committedContent = await commitFixture.service.setField(commitTask, 'priority', 'medium', {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'task-line-context-menu',
  });

  assert.equal(committedContent.ok, true, 'history commit errors must not roll back the content mutation');
  assert.match(committedContent.task?.rawLine || '', /\[priority:: medium\]/u);
  assert.equal(commitHistory.commit.length, 1);
  assert.equal(commitHistory.abort.length, 1, 'a rejected history commit must clear its pending intent');
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
  assert.match(taskApiSource, /return this\.update\(ref, \{ fields: \{ \[cleanKey\]: value \} \}, cause\)/);
  assert.match(taskApiSource, /return this\.list\(\{\s+\.\.\.filter,\s+fields: \{/);
});

test('task API records expose only TPS-owned stable task identities', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);

  const taskIdentity = fixture.service.parseLine(
    fixture.taskPath,
    0,
    '- [ ] Task identity [subitemId:: child-id] [tpsId:: task-id] [recurrenceTaskId:: series-id]',
  );
  const subitemIdentity = fixture.service.parseLine(
    fixture.taskPath,
    1,
    '- [ ] Subitem identity [subitemId:: child-only] [recurrenceTaskId:: series-id]',
  );
  const recurrenceOnly = fixture.service.parseLine(
    fixture.taskPath,
    2,
    '- [ ] Recurring task [recurrenceTaskId:: series-only]',
  );

  assert.equal(taskIdentity?.stableId, 'task-id', 'tpsId takes precedence over subitemId');
  assert.equal(subitemIdentity?.stableId, 'child-only');
  assert.equal(recurrenceOnly?.stableId, null, 'recurrence series IDs are not item-history identities');
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
  assert.match(taskApiSource, /if \(!rawPrefix\) return ordinaryFiles/);
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

test('task API move preserves a Daily Note source as a migrated record', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  });

  assert.equal(fixture.service.version, 3);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.task?.path, fixture.canonicalUpperFile.path);
  assert.ok(fixture.contents.get(fixture.dailyTaskPath).includes(
    '- [>] Daily task [scheduled:: 2026-08-10 09:00:00] [migratedTo:: [[Inbox/Upper]]]',
  ));
  assert.doesNotMatch(fixture.contents.get(fixture.dailyTaskPath), /\btpsId::|\bsubitemId::/u);
  assert.doesNotMatch(fixture.contents.get(fixture.dailyTaskPath), /completedDate::/u);
  assert.ok(fixture.contents.get(fixture.canonicalUpperFile.path).includes(
    '- [ ] Daily task [scheduled:: 2026-08-10 09:00:00] [tpsId:: task_daily]',
  ));
  assert.ok(fixture.contents.get(fixture.canonicalUpperFile.path).includes(
    '  - [ ] supporting detail [subitemId:: child_daily]',
  ));
});

test('configured Daily Note move policy follows the setting without changing explicit policies', async () => {
  const { TaskApiService } = await loadTaskApiModule();

  const removedFixture = createTaskApiFixture(TaskApiService);
  removedFixture.plugin.settings.dailyNoteTaskMoveSourceBehavior = 'remove';
  const [removedTask] = await removedFixture.service.list({
    paths: [removedFixture.dailyTaskPath],
    includeCompleted: true,
  });
  const removed = await removedFixture.service.move(removedTask, {
    targetPath: removedFixture.canonicalUpperFile.path,
    sourcePolicy: 'configured-daily-note',
    resolution: 'exact-or-identity',
  });
  assert.equal(removed.ok, true);
  assert.doesNotMatch(removedFixture.contents.get(removedFixture.dailyTaskPath), /Daily task|migratedTo::/u);
  assert.doesNotMatch(removedFixture.contents.get(removedFixture.dailyTaskPath), /supporting detail/u);
  assert.match(removedFixture.contents.get(removedFixture.canonicalUpperFile.path), /Daily task/u);

  const explicitFixture = createTaskApiFixture(TaskApiService);
  explicitFixture.plugin.settings.dailyNoteTaskMoveSourceBehavior = 'remove';
  const [explicitTask] = await explicitFixture.service.list({
    paths: [explicitFixture.dailyTaskPath],
    includeCompleted: true,
  });
  const explicit = await explicitFixture.service.move(explicitTask, {
    targetPath: explicitFixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  });
  assert.equal(explicit.ok, true);
  assert.match(explicitFixture.contents.get(explicitFixture.dailyTaskPath), /migratedTo::/u);
});

test('task API rejects an unknown runtime source policy before changing either note', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const originalSource = fixture.contents.get(fixture.dailyTaskPath);
  const originalTarget = fixture.contents.get(fixture.canonicalUpperFile.path);

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'configured-daily-notes',
    resolution: 'exact-or-identity',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.match(result.error || '', /unsupported source policy/iu);
  assert.equal(fixture.contents.get(fixture.dailyTaskPath), originalSource);
  assert.equal(fixture.contents.get(fixture.canonicalUpperFile.path), originalTarget);
});

test('task API move rolls back a Daily Note target copy when the source cannot be marked migrated', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const originalTarget = fixture.contents.get(fixture.canonicalUpperFile.path);
  const protectedSource = moveTaskIntoFenceBeforeNextSourceProcess(fixture, dailyTask);

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(fixture.contents.get(fixture.dailyTaskPath), protectedSource);
  assert.equal(fixture.contents.get(fixture.canonicalUpperFile.path), originalTarget);
});

test('task API reconciles a rejected target write that left identical preexisting content unchanged', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const originalSource = fixture.contents.get(fixture.dailyTaskPath);
  const originalTarget = [
    dailyTask.rawLine,
    '  - [ ] supporting detail [subitemId:: child_daily]',
    '',
  ].join('\n');
  fixture.contents.set(fixture.canonicalUpperFile.path, originalTarget);
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let rejected = false;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (!rejected && file.path === fixture.canonicalUpperFile.path) {
      rejected = true;
      updater(fixture.contents.get(file.path));
      throw new Error('synthetic target write rejection before commit');
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    placement: 'line',
    lineNumber: 0,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(fixture.contents.get(fixture.dailyTaskPath), originalSource);
  assert.equal(fixture.contents.get(fixture.canonicalUpperFile.path), originalTarget);
});

test('task API continues a move when a rejected target write committed the exact expected content', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let rejected = false;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (!rejected && file.path === fixture.canonicalUpperFile.path) {
      rejected = true;
      fixture.contents.set(file.path, updater(fixture.contents.get(file.path)));
      throw new Error('synthetic target write rejection after commit');
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.match(fixture.contents.get(fixture.dailyTaskPath), /migratedTo::/u);
  assert.match(fixture.contents.get(fixture.canonicalUpperFile.path), /Daily task/u);
});

test('task API reports a partial outcome when a rejected target write leaves conflicting content', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const history = installHistoryRecorder(fixture);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const originalSource = fixture.contents.get(fixture.dailyTaskPath);
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let rejected = false;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (!rejected && file.path === fixture.canonicalUpperFile.path) {
      rejected = true;
      const expected = updater(fixture.contents.get(file.path));
      fixture.contents.set(file.path, `${expected}conflicting target edit\n`);
      throw new Error('synthetic conflicted target write');
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  }, {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'task-line-drag',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, true);
  assert.equal(fixture.contents.get(fixture.dailyTaskPath), originalSource);
  assert.match(fixture.contents.get(fixture.canonicalUpperFile.path), /Daily task/u);
  assert.match(fixture.contents.get(fixture.canonicalUpperFile.path), /conflicting target edit/u);
  assert.equal(history.begin.length, 1);
  assert.equal(history.commit.length, 0, 'an unknown target snapshot must not fabricate a committed locator');
  assert.equal(history.abort.length, 1);
});

test('task API v2 keeps destructive Daily Note moves opt-in compatible', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.doesNotMatch(fixture.contents.get(fixture.dailyTaskPath), /Daily task/u);
  assert.doesNotMatch(fixture.contents.get(fixture.dailyTaskPath), /migratedTo::/u);
});

test('task API same-file moves report an unchanged in-block target as a no-op', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [task] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const before = fixture.contents.get(fixture.taskPath);

  const result = await fixture.service.move(task, {
    targetPath: fixture.taskPath,
    placement: 'line',
    lineNumber: task.lineNumber,
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(fixture.contents.get(fixture.taskPath), before);
});

test('task API move placement keeps the append default and honors explicit after-frontmatter', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const targetContent = [
    '---',
    'title: Destination',
    '---',
    '',
    '# Existing section',
    'Existing body',
    '',
  ].join('\n');

  const appendFixture = createTaskApiFixture(TaskApiService);
  appendFixture.contents.set(appendFixture.canonicalUpperFile.path, targetContent);
  const [appendTask] = await appendFixture.service.list({
    paths: [appendFixture.taskPath],
    includeCompleted: true,
  });
  const appended = await appendFixture.service.move(appendTask, {
    targetPath: appendFixture.canonicalUpperFile.path,
  });
  assert.equal(appended.ok, true);
  assert.equal(appended.task?.lineNumber, 6);
  assert.match(
    appendFixture.contents.get(appendFixture.canonicalUpperFile.path),
    /Existing body\n- \[ \] Open task\n$/u,
  );

  const topFixture = createTaskApiFixture(TaskApiService);
  topFixture.contents.set(topFixture.canonicalUpperFile.path, targetContent);
  const [topTask] = await topFixture.service.list({
    paths: [topFixture.taskPath],
    includeCompleted: true,
  });
  const insertedAfterFrontmatter = await topFixture.service.move(topTask, {
    targetPath: topFixture.canonicalUpperFile.path,
    placement: 'after-frontmatter',
  });
  assert.equal(insertedAfterFrontmatter.ok, true);
  assert.equal(insertedAfterFrontmatter.task?.lineNumber, 3);
  assert.match(
    topFixture.contents.get(topFixture.canonicalUpperFile.path),
    /^---\ntitle: Destination\n---\n- \[ \] Open task\n\n# Existing section/u,
  );
});

test('task API same-file after-frontmatter placement moves the complete block to the YAML boundary', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const tasks = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const workingTask = tasks.find((task) => task.title === 'Working task');

  const result = await fixture.service.move(workingTask, {
    targetPath: fixture.taskPath,
    placement: 'after-frontmatter',
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.task?.lineNumber, 3);
  assert.match(
    fixture.contents.get(fixture.taskPath),
    /^---\ntitle: Tasks\n---\n- \[\/\] Working task\n\n- \[ \] Open task/u,
  );
});

test('task API captures the latest nested block before inserting the target copy', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  fixture.contents.set(
    fixture.dailyTaskPath,
    fixture.contents.get(fixture.dailyTaskPath).replace('supporting detail', 'latest supporting detail'),
  );

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  });

  assert.equal(result.ok, true);
  assert.match(fixture.contents.get(fixture.canonicalUpperFile.path), /latest supporting detail/u);
  assert.match(fixture.contents.get(fixture.dailyTaskPath), /latest supporting detail/u);
});

test('task API rolls back when nested source content changes after target insertion', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const originalTarget = fixture.contents.get(fixture.canonicalUpperFile.path);
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let changedAfterCapture = false;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (!changedAfterCapture && file.path === fixture.canonicalUpperFile.path) {
      changedAfterCapture = true;
      fixture.contents.set(
        fixture.dailyTaskPath,
        fixture.contents.get(fixture.dailyTaskPath).replace('supporting detail', 'concurrent detail'),
      );
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.match(fixture.contents.get(fixture.dailyTaskPath), /concurrent detail/u);
  assert.doesNotMatch(fixture.contents.get(fixture.dailyTaskPath), /migratedTo::/u);
  assert.equal(fixture.contents.get(fixture.canonicalUpperFile.path), originalTarget);
});

test('task API rolls back a target copy when the source write throws', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const originalSource = fixture.contents.get(fixture.dailyTaskPath);
  const originalTarget = fixture.contents.get(fixture.canonicalUpperFile.path);
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let sourceCalls = 0;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (file.path === fixture.dailyTaskPath && ++sourceCalls === 2) {
      throw new Error('synthetic source write failure');
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(fixture.contents.get(fixture.dailyTaskPath), originalSource);
  assert.equal(fixture.contents.get(fixture.canonicalUpperFile.path), originalTarget);
});

test('task API rolls back when the source updater ran but its rejected write did not commit', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const originalSource = fixture.contents.get(fixture.dailyTaskPath);
  const originalTarget = fixture.contents.get(fixture.canonicalUpperFile.path);
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let sourceCalls = 0;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (file.path === fixture.dailyTaskPath && ++sourceCalls === 2) {
      updater(fixture.contents.get(file.path));
      throw new Error('synthetic source write rejection before commit');
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(fixture.contents.get(fixture.dailyTaskPath), originalSource);
  assert.equal(fixture.contents.get(fixture.canonicalUpperFile.path), originalTarget);
});

test('task API accepts a source write that committed exact expected content before rejecting', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let sourceCalls = 0;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (file.path === fixture.dailyTaskPath && ++sourceCalls === 2) {
      fixture.contents.set(file.path, updater(fixture.contents.get(file.path)));
      throw new Error('synthetic source write rejection after commit');
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.match(fixture.contents.get(fixture.dailyTaskPath), /migratedTo::/u);
  assert.match(fixture.contents.get(fixture.canonicalUpperFile.path), /Daily task/u);
});

test('task API preserves the target copy when a rejected source write leaves conflicting source content', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const history = installHistoryRecorder(fixture);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let sourceCalls = 0;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (file.path === fixture.dailyTaskPath && ++sourceCalls === 2) {
      updater(fixture.contents.get(file.path));
      fixture.contents.set(
        file.path,
        fixture.contents.get(file.path).replace('supporting detail', 'conflicting source detail'),
      );
      throw new Error('synthetic conflicted source write');
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  }, {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'task-line-drag',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, true);
  assert.match(result.error || '', /target copy was preserved/u);
  assert.match(fixture.contents.get(fixture.dailyTaskPath), /conflicting source detail/u);
  assert.doesNotMatch(fixture.contents.get(fixture.dailyTaskPath), /migratedTo::/u);
  assert.match(fixture.contents.get(fixture.canonicalUpperFile.path), /Daily task/u);
  assert.equal(history.commit.length, 1);
  assert.equal(history.abort.length, 0);
  assert.equal(history.commit[0].input.outcome, 'partial');
  assert.equal(history.commit[0].input.sourceDisposition, undefined);
  assert.equal(
    fixture.contents.get(fixture.canonicalUpperFile.path).split('\n')[history.commit[0].input.after.lineNumber],
    history.commit[0].input.after.rawLine,
  );
});

test('task API does not invent a source disposition when a conflicted source no longer has the task', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const history = installHistoryRecorder(fixture);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let sourceCalls = 0;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (file.path === fixture.dailyTaskPath && ++sourceCalls === 2) {
      const expectedRemoval = updater(fixture.contents.get(file.path));
      fixture.contents.set(file.path, `${expectedRemoval}External source edit\n`);
      throw new Error('synthetic source removal plus conflicting edit');
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'remove',
    resolution: 'exact-or-identity',
  }, {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'task-line-drag',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, true);
  assert.doesNotMatch(fixture.contents.get(fixture.dailyTaskPath), /Daily task/u);
  assert.match(fixture.contents.get(fixture.dailyTaskPath), /External source edit/u);
  assert.match(fixture.contents.get(fixture.canonicalUpperFile.path), /Daily task/u);
  assert.equal(history.commit.length, 1);
  assert.equal(history.commit[0].input.outcome, 'partial');
  assert.equal(history.commit[0].input.sourceDisposition, undefined);
  assert.equal(history.abort.length, 0);
});

test('task API reports a partial target copy when source write and rollback both fail', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const history = installHistoryRecorder(fixture);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const originalSource = fixture.contents.get(fixture.dailyTaskPath);
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let sourceCalls = 0;
  let targetCalls = 0;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (file.path === fixture.dailyTaskPath && ++sourceCalls === 2) {
      throw new Error('synthetic source write failure');
    }
    if (file.path === fixture.canonicalUpperFile.path && ++targetCalls === 2) {
      throw new Error('synthetic rollback failure');
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  }, {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'task-line-drag',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, true);
  assert.equal(fixture.contents.get(fixture.dailyTaskPath), originalSource);
  assert.match(fixture.contents.get(fixture.canonicalUpperFile.path), /Daily task/u);
  assert.equal(history.commit.length, 1);
  assert.equal(history.abort.length, 0);
  assert.equal(history.commit[0].input.outcome, 'partial');
  assert.equal(history.commit[0].input.sourceDisposition, undefined);
  assert.equal(
    fixture.contents.get(fixture.canonicalUpperFile.path).split('\n')[history.commit[0].input.after.lineNumber],
    history.commit[0].input.after.rawLine,
  );
});

test('task API aborts partial move history when failed rollback leaves no confirmed target task', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const history = installHistoryRecorder(fixture);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const originalSource = fixture.contents.get(fixture.dailyTaskPath);
  const originalTarget = fixture.contents.get(fixture.canonicalUpperFile.path);
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let sourceCalls = 0;
  let targetCalls = 0;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (file.path === fixture.dailyTaskPath && ++sourceCalls === 2) {
      throw new Error('synthetic source write failure');
    }
    if (file.path === fixture.canonicalUpperFile.path && ++targetCalls === 2) {
      fixture.contents.set(file.path, `${originalTarget}conflicting target content\n`);
      throw new Error('synthetic conflicted rollback failure');
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  }, {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'task-line-drag',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, true);
  assert.equal(fixture.contents.get(fixture.dailyTaskPath), originalSource);
  assert.equal(fixture.contents.get(fixture.canonicalUpperFile.path), `${originalTarget}conflicting target content\n`);
  assert.equal(history.begin.length, 1);
  assert.equal(history.commit.length, 0, 'unconfirmed target content must not produce a fabricated partial event');
  assert.equal(history.abort.length, 1);
});

test('task API aborts partial move history when the preserved target task itself changed', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const history = installHistoryRecorder(fixture);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  let sourceCalls = 0;
  let targetCalls = 0;
  fixture.plugin.app.vault.process = async (file, updater) => {
    if (file.path === fixture.dailyTaskPath && ++sourceCalls === 2) {
      throw new Error('synthetic source write failure');
    }
    if (file.path === fixture.canonicalUpperFile.path && ++targetCalls === 2) {
      fixture.contents.set(
        file.path,
        fixture.contents.get(file.path).replace(
          /(- \[ \] Daily task[^\n]*)/u,
          '$1 [priority:: high]',
        ),
      );
      throw new Error('synthetic conflicted rollback failure');
    }
    return process(file, updater);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  }, {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'task-line-drag',
  });

  assert.equal(result.ok, false);
  assert.equal(result.changed, true);
  assert.match(fixture.contents.get(fixture.canonicalUpperFile.path), /priority:: high/u);
  assert.equal(history.commit.length, 0, 'a changed target task is not exact confirmed history');
  assert.equal(history.abort.length, 1);
});

test('task API reports a committed move when post-commit task refresh fails', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const history = installHistoryRecorder(fixture);
  const [dailyTask] = await fixture.service.list({
    paths: [fixture.dailyTaskPath],
    includeCompleted: true,
  });
  const process = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  const cachedRead = fixture.plugin.app.vault.cachedRead.bind(fixture.plugin.app.vault);
  let sourceCalls = 0;
  let sourceCommitted = false;
  fixture.plugin.app.vault.process = async (file, updater) => {
    const result = await process(file, updater);
    if (file.path === fixture.dailyTaskPath && ++sourceCalls === 2) sourceCommitted = true;
    return result;
  };
  fixture.plugin.app.vault.cachedRead = async (file) => {
    if (sourceCommitted && file.path === fixture.canonicalUpperFile.path) {
      throw new Error('synthetic refresh failure');
    }
    return cachedRead(file);
  };

  const result = await fixture.service.move(dailyTask, {
    targetPath: fixture.canonicalUpperFile.path,
    sourcePolicy: 'migrate-if-daily-note',
    resolution: 'exact-or-identity',
  }, {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'task-line-drag',
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.task, null);
  assert.match(result.error || '', /could not be refreshed/u);
  assert.match(fixture.contents.get(fixture.dailyTaskPath), /migratedTo::/u);
  assert.match(fixture.contents.get(fixture.canonicalUpperFile.path), /Daily task/u);
  assert.equal(history.commit.length, 1, 'history uses an exact vault read rather than the failed cached refresh');
  assert.equal(history.abort.length, 0);
  assert.equal(history.commit[0].input.outcome, 'committed');
});

test('compiled task API excludes frontmatter, fenced, and indented code tasks', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.contents.set(fixture.taskPath, [
    '---',
    'quarantine:',
    '  - [ ] Hidden frontmatter task',
    '---',
    '```md',
    '- [ ] Hidden fenced task',
    '```',
    '',
    '    - [ ] Hidden indented task',
    '',
    '- [ ] Visible task',
  ].join('\n'));

  const tasks = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  assert.deepEqual(tasks.map(({ title, line }) => ({ title, line })), [
    { title: 'Visible task', line: 11 },
  ]);
  assert.equal(await fixture.service.get({
    path: fixture.taskPath,
    line: 6,
    rawLine: '- [ ] Hidden fenced task',
  }), null);
});

test('task API mutations revalidate Markdown protection inside each write callback', async () => {
  const { TaskApiService } = await loadTaskApiModule();

  const updateFixture = createTaskApiFixture(TaskApiService);
  const [updateTask] = await updateFixture.service.list({ paths: [updateFixture.taskPath], includeCompleted: true });
  const protectedUpdate = moveTaskIntoFenceBeforeNextSourceProcess(updateFixture, updateTask);
  const updated = await updateFixture.service.update(updateTask, { title: 'Must not edit code' });
  assert.equal(updated.ok, false);
  assert.equal(updated.changed, false);
  assert.equal(updateFixture.contents.get(updateFixture.taskPath), protectedUpdate);

  const deleteFixture = createTaskApiFixture(TaskApiService);
  const [deleteTask] = await deleteFixture.service.list({ paths: [deleteFixture.taskPath], includeCompleted: true });
  const protectedDelete = moveTaskIntoFenceBeforeNextSourceProcess(deleteFixture, deleteTask);
  const deleted = await deleteFixture.service.delete(deleteTask);
  assert.equal(deleted.ok, false);
  assert.equal(deleted.changed, false);
  assert.equal(deleteFixture.contents.get(deleteFixture.taskPath), protectedDelete);

  const sameFileFixture = createTaskApiFixture(TaskApiService);
  const [sameFileTask] = await sameFileFixture.service.list({ paths: [sameFileFixture.taskPath], includeCompleted: true });
  const protectedSameFileMove = moveTaskIntoFenceBeforeNextSourceProcess(sameFileFixture, sameFileTask);
  const sameFileMove = await sameFileFixture.service.move(sameFileTask, {
    targetPath: sameFileFixture.taskPath,
    placement: 'line',
    lineNumber: 0,
  });
  assert.equal(sameFileMove.ok, false);
  assert.equal(sameFileMove.changed, false);
  assert.equal(sameFileFixture.contents.get(sameFileFixture.taskPath), protectedSameFileMove);

  const crossFileFixture = createTaskApiFixture(TaskApiService);
  const [crossFileTask] = await crossFileFixture.service.list({ paths: [crossFileFixture.taskPath], includeCompleted: true });
  const originalTarget = crossFileFixture.contents.get(crossFileFixture.canonicalUpperFile.path);
  const protectedCrossFileMove = moveTaskIntoFenceBeforeNextSourceProcess(crossFileFixture, crossFileTask);
  const crossFileMove = await crossFileFixture.service.move(crossFileTask, {
    targetFile: { path: crossFileFixture.canonicalUpperFile.path },
  });
  assert.equal(crossFileMove.ok, false);
  assert.equal(crossFileMove.changed, false);
  assert.equal(crossFileFixture.contents.get(crossFileFixture.taskPath), protectedCrossFileMove);
  assert.equal(
    crossFileFixture.contents.get(crossFileFixture.canonicalUpperFile.path),
    originalTarget,
    'a stale cross-file move must roll back its target insertion',
  );
});

test('task API writes preserve actionable CR-only task coordinates', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.contents.set(fixture.taskPath, [
    '---',
    'title: Classic Mac',
    '---',
    '- [ ] CR task',
    '',
  ].join('\r'));

  const [task] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  assert.deepEqual({ title: task.title, line: task.line, lineNumber: task.lineNumber }, {
    title: 'CR task',
    line: 4,
    lineNumber: 3,
  });

  const result = await fixture.service.update(task, { title: 'CR task updated' });
  const updatedContent = fixture.contents.get(fixture.taskPath);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.match(updatedContent, /- \[ \] CR task updated/u);
  assert.equal(updatedContent.includes('\n'), false);
  assert.equal(updatedContent.split('\r').length, 5);
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

test('task creation uses the configured primary todo marker instead of an unchecked fallback', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[o]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  ];

  const created = await fixture.service.create({
    title: 'Custom primary open marker',
    targetPath: fixture.taskPath,
    notice: false,
  });

  assert.equal(created.ok, true);
  assert.match(created.task?.rawLine || '', /^- \[o\] Custom primary open marker$/u);
  assert.doesNotMatch(created.task?.rawLine || '', /^- \[ \]/u);
});

test('task creation preflights every checkbox/status input route before target resolution or writes', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const invalidInputs = [
    { label: 'malformed explicit checkbox', input: { checkbox: '[]' } },
    { label: 'unowned explicit checkbox', input: { checkbox: '[!]' } },
    { label: 'blank explicit status', input: { status: '   ' } },
    { label: 'unmapped explicit status', input: { status: 'reviewing' } },
    { label: 'malformed raw-line checkbox', input: { rawLine: '- [] Broken raw marker' } },
    { label: 'unowned raw-line checkbox', input: { rawLine: '- [!] Unsupported raw marker' } },
    { label: 'missing raw-line checkbox', input: { rawLine: '- Plain bullet is not a task' } },
    { label: 'unmapped fields.status', input: { fields: { status: 'reviewing' } } },
    { label: 'unmapped fields.task.status', input: { fields: { 'task.status': 'reviewing' } } },
    { label: 'unmapped fields.checkboxStatus', input: { fields: { checkboxStatus: 'reviewing' } } },
  ];

  for (const { label, input } of invalidInputs) {
    const result = await fixture.service.create({
      title: label,
      ...input,
      notice: false,
    });
    assert.equal(result.ok, false, label);
    assert.equal(result.changed, false, label);
    assert.equal(result.task, null, label);
  }

  assert.equal(fixture.getDailyNoteFallbackCalls(), 0, 'invalid mapping inputs must fail before resolving the Daily Note target');
  assert.equal(fixture.processes.length, 0, 'invalid mapping inputs must perform zero vault writes');
});

test('task creation fails an unavailable implied todo mapping closed instead of writing an empty checkbox', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[d]', statuses: ['complete'], toggleTargetStatus: 'complete' },
  ];

  const result = await fixture.service.create({
    title: 'No todo mapping',
    notice: false,
  });

  assert.equal(result.ok, false);
  assert.match(result.error || '', /No checkbox mapping is configured for status "todo"/u);
  assert.equal(fixture.getDailyNoteFallbackCalls(), 0, 'the unavailable default must fail before resolving a target');
  assert.equal(fixture.processes.length, 0);
  assert.doesNotMatch(fixture.contents.get(fixture.taskPath), /- \[\] No todo mapping/u);
});

test('task creation accepts and canonicalizes a configured custom raw-line marker', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[o]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  ];

  const created = await fixture.service.create({
    title: 'Canonical raw marker',
    targetPath: fixture.taskPath,
    rawLine: '- [X] Canonical raw marker',
    notice: false,
  });

  assert.equal(created.ok, true);
  assert.equal(created.task?.rawLine, '- [x] Canonical raw marker');
  assert.equal(created.task?.status, 'complete');
});

test('setCompletion uses configured mappings and runs the canonical checklist follow-up before invalidation', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[*]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  ];
  fixture.contents.set(
    fixture.taskPath,
    fixture.contents.get(fixture.taskPath).replace('- [ ] Open task', '- [?] Open task'),
  );

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
  assert.equal(fixture.checklistMutations[0].previousState, '?');
  assert.equal(fixture.checklistMutations[0].nextState, '*');
  assert.equal(fixture.checklistMutations[0].lineIndex, 4);
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
  assert.equal(classifyMappedTaskCheckboxState(mappings, '[X]').isComplete, false);
  assert.equal(classifyMappedTaskCheckboxState(mappings, '/').isOpen, true);
  assert.equal(classifyMappedTaskCheckboxState(mappings, '-').isComplete, true);
  assert.deepEqual(classifyMappedTaskCheckboxState(mappings, '[!]'), {
    marker: '!',
    status: null,
    isComplete: false,
    isMigrated: false,
    isOpen: false,
  });
  assert.equal(classifyMappedTaskCheckboxState(mappings, '[🟢]').marker, null);
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
  fixture.contents.set(
    fixture.taskPath,
    fixture.contents.get(fixture.taskPath).replace('- [ ] Open task', '- [?] Open task'),
  );
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
  fixture.contents.set(
    fixture.taskPath,
    fixture.contents.get(fixture.taskPath).replace('- [ ] Open task', '- [?] Open task'),
  );
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
  const history = installHistoryRecorder(fixture);
  const cause = {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'linked-context-checkbox',
  };
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[*]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'complete' },
  ];
  fixture.contents.set(
    fixture.taskPath,
    fixture.contents.get(fixture.taskPath).replace('- [ ] Open task', '- [?] Open task'),
  );
  fixture.plugin.taskCheckboxHandler.handleExternalChecklistStateMutation = async () => {
    fixture.mutationTimeline.push('checklist-followup');
    const lines = fixture.contents.get(fixture.taskPath).split('\n');
    lines.splice(5, 0, lines[4]);
    fixture.contents.set(fixture.taskPath, lines.join('\n'));
  };

  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const completed = await fixture.service.setCompletion(openTask, true, cause);

  assert.equal(completed.ok, true);
  assert.equal(completed.changed, true);
  assert.equal(completed.task, null, 'duplicate post-follow-up identities must not select by stale line number');
  assert.equal(history.begin.length, 1);
  assert.equal(history.commit.length, 0, 'ambiguous post-follow-up state cannot become successful history');
  assert.equal(history.abort.length, 1);
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
  const history = installHistoryRecorder(fixture);
  const cause = {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'linked-context-checkbox',
  };
  fixture.plugin.taskCheckboxHandler.handleExternalChecklistStateMutation = async () => {
    fixture.mutationTimeline.push('checklist-followup');
    const lines = fixture.contents.get(fixture.taskPath).split('\n');
    lines[4] = '- Follow-up replaced the task with a bullet';
    fixture.contents.set(fixture.taskPath, lines.join('\n'));
  };

  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const completed = await fixture.service.setCompletion(openTask, true, cause);

  assert.equal(completed.ok, true);
  assert.equal(completed.changed, true);
  assert.equal(completed.task, null);
  assert.equal(history.begin.length, 1);
  assert.equal(history.commit.length, 0, 'a removed post-follow-up task cannot retain a fabricated locator');
  assert.equal(history.abort.length, 1);
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

test('setCheckbox rejects malformed and configured-unowned states before resolving or writing the task', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const readsBefore = fixture.reads.length;
  const processesBefore = fixture.processes.length;

  const malformed = await fixture.service.setCheckbox(openTask, '[]');
  const unowned = await fixture.service.setCheckbox(openTask, '[!]');

  assert.equal(malformed.ok, false);
  assert.match(malformed.error || '', /exactly one marker character/u);
  assert.equal(unowned.ok, false);
  assert.match(unowned.error || '', /No checkbox mapping is configured for state "\[!\]"/u);
  assert.equal(fixture.reads.length, readsBefore, 'invalid states must fail before task resolution');
  assert.equal(fixture.processes.length, processesBefore, 'invalid states must perform zero vault writes');
});

test('task status mutations fail closed when no configured mapping owns the requested status', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const processCount = fixture.processes.length;

  const update = await fixture.service.setStatus(openTask, 'reviewing');
  const create = await fixture.service.create({
    title: 'Unsupported status',
    targetPath: fixture.taskPath,
    status: 'reviewing',
    notice: false,
  });

  assert.equal(update.ok, false);
  assert.match(update.error, /No checkbox mapping is configured/u);
  assert.equal(create.ok, false);
  assert.match(create.error, /No checkbox mapping is configured/u);
  assert.equal(fixture.processes.length, processCount, 'unmapped status requests must perform zero vault writes');
});

test('task status mutations apply aliases through the configured marker and completion semantics', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.sharedServices.status.normalize = (value) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'done' || normalized === 'completed' ? 'complete' : normalized;
  };
  fixture.plugin.sharedServices.status.getDoneStatuses = () => ['complete', 'wont-do'];
  fixture.plugin.settings.linkedSubitemCheckboxMappings = [
    { checkboxState: '[d]', statuses: ['done'], toggleTargetStatus: 'todo' },
    { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'done' },
  ];
  fixture.contents.set(
    fixture.taskPath,
    fixture.contents.get(fixture.taskPath).replace('- [ ] Open task', '- [?] Open task'),
  );
  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });

  const completed = await fixture.service.setStatus(openTask, 'completed');

  assert.equal(completed.ok, true);
  assert.equal(completed.task?.checkbox, '[d]');
  assert.equal(completed.task?.status, 'complete');
  assert.equal(completed.task?.isComplete, true);
  assert.match(completed.task?.rawLine || '', /\[completedDate::/u);
});

test('task API checkbox workflow writes clear only owned status carriers and preserve relational status', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  fixture.plugin.settings.properties = [{
    id: 'status',
    key: 'status',
    type: 'selector',
    acceptsKind: 'status',
    optionSources: ['entity'],
  }];
  fixture.plugin.sharedServices.status.getStatusPropertyKey = () => 'taskStatus';
  fixture.plugin.sharedServices.status.getRelationalStatusPropertyKey = () => 'status';
  fixture.contents.set(fixture.taskPath, [
    '- [ ] Owned cleanup',
    '  [taskStatus:: todo]',
  ].join(' ')
    + ' [status:: [[Statuses/Blocked]]]'
    + ' [task.status:: todo] [task.checkboxStatus:: todo] [checkboxStatus:: todo]'
    + ' [priority:: high] `[task.status:: example]`\n');
  const [task] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });

  const result = await fixture.service.setField(task, 'task.status', 'working');

  assert.equal(result.ok, true);
  assert.equal(result.task?.checkbox, '[/]');
  const rawLine = result.task?.rawLine || '';
  const semanticLine = rawLine.replace(/`[^`]*`/gu, '');
  assert.match(rawLine, /\[status:: \[\[Statuses\/Blocked\]\]\]/u);
  assert.match(rawLine, /\[priority:: high\]/u);
  assert.match(rawLine, /`\[task\.status:: example\]`/u);
  assert.doesNotMatch(semanticLine, /\[(?:taskStatus|task\.status|task\.checkboxStatus|checkboxStatus)::/iu);
});

test('task API create and update refuse mapping revisions inside their atomic updater', async () => {
  const { TaskApiService } = await loadTaskApiModule();

  const updateFixture = createTaskApiFixture(TaskApiService);
  const [openTask] = await updateFixture.service.list({ paths: [updateFixture.taskPath], includeCompleted: true });
  const updateBefore = updateFixture.contents.get(updateFixture.taskPath);
  const updateProcess = updateFixture.plugin.app.vault.process.bind(updateFixture.plugin.app.vault);
  updateFixture.plugin.app.vault.process = async (file, updater) => {
    updateFixture.plugin.settings.linkedSubitemCheckboxMappings = [
      { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete' },
    ];
    return updateProcess(file, updater);
  };

  const update = await updateFixture.service.setStatus(openTask, 'complete');

  assert.equal(update.ok, false);
  assert.equal(update.changed, false);
  assert.match(update.error || '', /mappings changed/u);
  assert.equal(updateFixture.contents.get(updateFixture.taskPath), updateBefore);

  const createFixture = createTaskApiFixture(TaskApiService);
  const createBefore = createFixture.contents.get(createFixture.taskPath);
  const createProcess = createFixture.plugin.app.vault.process.bind(createFixture.plugin.app.vault);
  createFixture.plugin.app.vault.process = async (file, updater) => {
    createFixture.plugin.settings.linkedSubitemCheckboxMappings = [
      { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    ];
    return createProcess(file, updater);
  };

  const create = await createFixture.service.create({
    title: 'Must not race the mapping',
    targetPath: createFixture.taskPath,
    notice: false,
  });

  assert.equal(create.ok, false);
  assert.equal(create.changed, false);
  assert.match(create.error || '', /mappings changed/u);
  assert.equal(createFixture.contents.get(createFixture.taskPath), createBefore);
});

test('task API checkbox updates refuse a relocated same-title task whose workflow token changed', async () => {
  const { TaskApiService } = await loadTaskApiModule();
  const fixture = createTaskApiFixture(TaskApiService);
  const [openTask] = await fixture.service.list({ paths: [fixture.taskPath], includeCompleted: true });
  const originalProcess = fixture.plugin.app.vault.process.bind(fixture.plugin.app.vault);
  const concurrentLine = '- [x] Open task';
  fixture.plugin.app.vault.process = async (file, updater) => {
    fixture.contents.set(
      fixture.taskPath,
      fixture.contents.get(fixture.taskPath).replace('- [ ] Open task', concurrentLine),
    );
    return originalProcess(file, updater);
  };

  const update = await fixture.service.setStatus(openTask, 'working');

  assert.equal(update.ok, false);
  assert.equal(update.changed, false);
  assert.match(update.error || '', /changed before it could be updated/u);
  assert.match(fixture.contents.get(fixture.taskPath), /- \[x\] Open task/u);
  assert.doesNotMatch(fixture.contents.get(fixture.taskPath), /- \[\/\] Open task/u);
});

test('task API mutations preserve safe task-specific behavior', () => {
  assert.match(taskApiSource, /this\.plugin\.app\.vault\.process\(targetFile/);
  assert.match(taskApiSource, /this\.plugin\.app\.vault\.process\(resolved\.file/);
  assert.match(taskApiSource, /insertLineAfterFrontmatter\(content, insertedRawLine\)/);
  assert.match(taskApiSource, /insertTaskBlockAtEnd\(content, targetBlock\)/);
  assert.match(taskApiSource, /insertTaskBlockAfterFrontmatter\(content, targetBlock\)/);
  assert.match(taskApiSource, /private resolveMutableTaskLine\(/);
  assert.match(taskApiSource, /const currentBlock = extractTaskBlock\(currentResolution\.parts\.lines, currentResolution\.index\)/u);
  assert.match(taskApiSource, /if \(!this\.taskBlocksMatch\(currentBlock\.lines, capturedBlock\)\) return content/u);
  assert.match(taskApiSource, /removeTaskBlockFromContent\(\s*content,\s*currentResolution\.index,\s*capturedRawLine,\s*resolved\.record\.title/u);
  assert.match(taskApiSource, /private async classifyRejectedWrite\(/u);
  assert.match(taskApiSource, /private async rollbackTargetSnapshot\(/u);
  assert.ok(taskApiSource.includes('setTaskCheckboxWorkflowState(next, `[${marker}]`, workflowFieldOwnership)'));
  assert.ok(taskApiSource.includes('updateTaskCompletedDateForCheckboxState(next, `[${marker}]`'));
  assert.match(taskApiSource, /clearTaskCheckboxOwnedWorkflowFields/);
  assert.match(taskApiSource, /mappingPlanIsCurrent/);
  assert.match(taskApiSource, /private preflightTaskInputMappings\(/);
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
