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
