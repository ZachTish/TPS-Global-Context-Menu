import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadTaskCheckboxHandlerModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/handlers/task-checkbox-handler.ts', import.meta.url))],
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
          contents: `
            export class App {}
            export class MarkdownView {}
            export class Menu {}
            export class Setting {}
            export class Notice {}
            export class TFile {}
            export class Modal {
              constructor(app) {
                this.app = app;
                this.modalEl = { addClass() {} };
                this.contentEl = { empty() {}, createEl() { return {}; }, createDiv() { return {}; } };
              }
              open() { this.onOpen?.(); }
              close() { this.onClose?.(); }
            }
          `,
          loader: 'js',
        }));
      },
    }],
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const handlerModule = loadTaskCheckboxHandlerModule();

function createFixture(TaskCheckboxHandler, overrides = {}) {
  const timeline = [];
  const file = { path: 'Inbox/Recurring.md', extension: 'md' };
  let currentContent = '- [*] Recurring item';
  const plugin = {
    app: {
      vault: {
        async read(target) {
          timeline.push('read');
          assert.equal(target, file);
          if (overrides.readError) throw overrides.readError;
          return currentContent;
        },
      },
      metadataCache: {
        getFileCache(target) {
          assert.equal(target, file);
          return { frontmatter: { status: 'working' } };
        },
      },
    },
    settings: {
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[*]', statuses: ['complete'], toggleTargetStatus: 'todo' },
        { checkboxState: '[?]', statuses: ['todo'], toggleTargetStatus: 'complete' },
        { checkboxState: '[/]', statuses: ['working'], toggleTargetStatus: 'complete' },
        { checkboxState: '[>]', statuses: ['migrated'], toggleTargetStatus: 'todo' },
      ],
      checklistFinalPromptStatuses: ['complete', 'wont-do'],
    },
    sharedServices: {
      status: {
        getStatusPropertyKey: () => 'status',
        getStatuses: (frontmatter, key) => [String(frontmatter?.[key] || '')].filter(Boolean),
        isDoneStatus: (status) => ['complete', 'wont-do'].includes(String(status || '').toLowerCase()),
        getDoneStatuses: () => ['complete', 'wont-do'],
        normalize: (status) => String(status || '').trim().toLowerCase(),
      },
    },
    taskRecurrenceService: {
      async handleTaskCompletion(input) {
        timeline.push('recurrence');
        if (overrides.onRecurrence) await overrides.onRecurrence(input, {
          getContent: () => currentContent,
          setContent: (content) => { currentContent = content; },
        });
        if (overrides.recurrenceError) throw overrides.recurrenceError;
      },
    },
    bulkEditService: {
      async setStatus(files, status) {
        timeline.push(`set-status:${status}`);
        assert.deepEqual(files, [file]);
      },
    },
  };
  const handler = new TaskCheckboxHandler(plugin);
  handler.scheduleChecklistPropertyUpdate = () => {
    timeline.push('property');
    if (overrides.propertyError) throw overrides.propertyError;
  };
  handler.promptForFinalChecklistStatus = async () => {
    timeline.push('prompt');
    if (overrides.promptError) throw overrides.promptError;
    return overrides.promptResult ?? null;
  };
  return {
    file,
    handler,
    timeline,
    setContent: (content) => { currentContent = content; },
  };
}

function createNativeCheckboxMutationFixture(
  TaskCheckboxHandler,
  { changeMappingsBeforeUpdater = false, liveLineBeforeUpdater = null } = {},
) {
  const file = { path: 'Inbox/Native.md', extension: 'md' };
  let content = '- [ ] Native task [taskStatus:: todo] [status:: [[Statuses/Blocked]]] [task.status:: todo] [task.checkboxStatus:: todo] [checkboxStatus:: todo] [priority:: high] `[task.status:: example]`';
  const plugin = {
    app: {},
    settings: {
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete' },
        { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo' },
      ],
      autoSyncFileTimestamps: false,
      dateModifiedFrontmatterKey: 'modifiedDate',
      fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
    },
    sharedServices: {
      status: {
        getStatusPropertyKey: () => 'taskStatus',
        getRelationalStatusPropertyKey: () => 'status',
        getDoneStatuses: () => ['complete'],
        normalize: (value) => String(value ?? '').trim().toLowerCase(),
      },
    },
    subitemRelationshipSyncService: {
      async mutateMarkdownBody(target, updater) {
        assert.equal(target, file);
        if (liveLineBeforeUpdater != null) content = String(liveLineBeforeUpdater);
        if (changeMappingsBeforeUpdater) {
          plugin.settings.linkedSubitemCheckboxMappings = [
            { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete' },
          ];
        }
        const lines = content.split('\n');
        if (await updater(lines)) content = lines.join('\n');
      },
    },
  };
  const handler = new TaskCheckboxHandler(plugin);
  handler.handleExternalChecklistStateMutation = async () => {};
  const context = {
    file,
    lineNumber: 0,
    rawLine: content,
    currentToken: '[ ]',
  };
  return {
    handler,
    context,
    plugin,
    getContent: () => content,
  };
}

test('native checkbox menu clears checkbox-owned workflow fields without touching relational status', async () => {
  const { TaskCheckboxHandler } = await handlerModule;
  const fixture = createNativeCheckboxMutationFixture(TaskCheckboxHandler);

  await fixture.handler.setTaskCheckboxState(fixture.context, '[x]');

  const rawLine = fixture.getContent();
  const semanticLine = rawLine.replace(/`[^`]*`/gu, '');
  assert.match(rawLine, /^- \[x\] Native task/u);
  assert.match(rawLine, /\[status:: \[\[Statuses\/Blocked\]\]\]/u);
  assert.match(rawLine, /\[priority:: high\]/u);
  assert.match(rawLine, /`\[task\.status:: example\]`/u);
  assert.doesNotMatch(semanticLine, /\[(?:taskStatus|task\.status|task\.checkboxStatus|checkboxStatus)::/iu);
});

test('native checkbox menu journals the committed user action with an atomic stable identity', async () => {
  const { TaskCheckboxHandler } = await handlerModule;
  const fixture = createNativeCheckboxMutationFixture(TaskCheckboxHandler);
  const history = { begin: [], ensure: [], commit: [], abort: [] };
  fixture.plugin.itemHistoryService = {
    async beginTaskMutation(input) {
      history.begin.push(structuredClone(input));
      return { operationId: 'op_checkbox', entityId: 'item_checkbox' };
    },
    ensureTaskIdentity(handle, line) {
      history.ensure.push({ handle, line });
      return `${line} [id:: ${handle.entityId}]`;
    },
    async commitTaskMutation(handle, input) {
      history.commit.push({ handle, input: structuredClone(input) });
    },
    async abortTaskMutation(handle) {
      history.abort.push(handle);
    },
  };

  await fixture.handler.setTaskCheckboxState(fixture.context, '[x]');

  assert.match(fixture.getContent(), /\[id:: item_checkbox\]/u);
  assert.equal(history.begin.length, 1);
  assert.equal(history.begin[0].action, 'task.checkbox');
  assert.equal(history.begin[0].cause.surface, 'checkbox-context-menu');
  assert.equal(history.commit.length, 1);
  assert.equal(history.commit[0].input.outcome, 'committed');
  assert.match(history.commit[0].input.after.rawLine, /\[id:: item_checkbox\]/u);
  assert.equal(history.abort.length, 0);
});

test('native checkbox menu refuses a mapping change inside the body mutation callback', async () => {
  const { TaskCheckboxHandler } = await handlerModule;
  const fixture = createNativeCheckboxMutationFixture(TaskCheckboxHandler, {
    changeMappingsBeforeUpdater: true,
  });
  const before = fixture.getContent();

  await fixture.handler.setTaskCheckboxState(fixture.context, '[x]');

  assert.equal(fixture.getContent(), before);
});

test('native checkbox menu refuses a relocated same-title task whose workflow token changed', async () => {
  const { TaskCheckboxHandler } = await handlerModule;
  const liveLine = '- [x] Native task [priority:: high]';
  const fixture = createNativeCheckboxMutationFixture(TaskCheckboxHandler, {
    liveLineBeforeUpdater: liveLine,
  });

  await fixture.handler.setTaskCheckboxState(fixture.context, '[/]');

  assert.equal(fixture.getContent(), liveLine);
});
