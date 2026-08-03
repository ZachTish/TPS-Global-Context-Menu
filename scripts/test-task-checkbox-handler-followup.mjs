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
    getContent: () => content,
  };
}

test('final-note evaluation reads post-recurrence content and sees a newly generated mapped open task', async () => {
  const { TaskCheckboxHandler } = await handlerModule;
  const updatedLines = ['- [*] Recurring item'];
  const fixture = createFixture(TaskCheckboxHandler, {
    onRecurrence(input, content) {
      assert.equal(input.file.path, 'Inbox/Recurring.md');
      assert.equal(input.previousState, '?');
      assert.equal(input.nextState, '*');
      assert.equal(input.updatedLines, updatedLines);
      content.setContent(`${content.getContent()}\n- [?] Recurring item`);
    },
  });

  await fixture.handler.handleExternalChecklistStateMutation(
    fixture.file,
    '?',
    '*',
    updatedLines,
  );

  assert.deepEqual(fixture.timeline, ['recurrence', 'read', 'property']);
  assert.ok(!fixture.timeline.includes('prompt'), 'the generated open recurrence must suppress the final-note prompt');
});

test('recurrence and prompt failures do not prevent later follow-ups and the first failure reaches the caller', async () => {
  const { TaskCheckboxHandler } = await handlerModule;
  const recurrenceError = new Error('recurrence failed');
  const promptError = new Error('prompt failed');
  const fixture = createFixture(TaskCheckboxHandler, { recurrenceError, promptError });

  await assert.rejects(
    fixture.handler.handleExternalChecklistStateMutation(
      fixture.file,
      '?',
      '*',
      ['- [*] Recurring item'],
    ),
    (error) => error === recurrenceError,
  );

  assert.deepEqual(fixture.timeline, ['recurrence', 'read', 'prompt', 'property']);
});

test('an authoritative read failure still schedules checklist-property synchronization', async () => {
  const { TaskCheckboxHandler } = await handlerModule;
  const readError = new Error('read failed');
  const fixture = createFixture(TaskCheckboxHandler, { readError });

  await assert.rejects(
    fixture.handler.handleExternalChecklistStateMutation(
      fixture.file,
      '?',
      '*',
      ['- [*] Recurring item'],
    ),
    (error) => error === readError,
  );

  assert.deepEqual(fixture.timeline, ['recurrence', 'read', 'property']);
});

test('a final-note prompt failure is surfaced after checklist-property synchronization is scheduled', async () => {
  const { TaskCheckboxHandler } = await handlerModule;
  const promptError = new Error('prompt failed');
  const fixture = createFixture(TaskCheckboxHandler, { promptError });

  await assert.rejects(
    fixture.handler.handleExternalChecklistStateMutation(
      fixture.file,
      '?',
      '*',
      ['- [*] Recurring item'],
    ),
    (error) => error === promptError,
  );

  assert.deepEqual(fixture.timeline, ['recurrence', 'read', 'prompt', 'property']);
});

test('a checklist-property scheduling failure is surfaced after recurrence and live-state evaluation', async () => {
  const { TaskCheckboxHandler } = await handlerModule;
  const propertyError = new Error('property scheduling failed');
  const fixture = createFixture(TaskCheckboxHandler, { propertyError });
  fixture.setContent('- [*] Recurring item\n- [?] Another mapped open item');

  await assert.rejects(
    fixture.handler.handleExternalChecklistStateMutation(
      fixture.file,
      '?',
      '*',
      ['- [*] Recurring item'],
    ),
    (error) => error === propertyError,
  );

  assert.deepEqual(fixture.timeline, ['recurrence', 'read', 'property']);
});

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
