import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

globalThis.__homeCaptureServiceSource = readFileSync(new URL('../src/services/home-capture-service.ts', import.meta.url), 'utf8');
globalThis.__homeViewSource = readFileSync(new URL('../src/views/home-view.ts', import.meta.url), 'utf8');
globalThis.__gcmCommandSource = readFileSync(new URL('../src/commands/register-commands.ts', import.meta.url), 'utf8');

async function loadCaptureServiceModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/home-capture-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian-stub', namespace: 'obsidian-stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'obsidian-stub' }, () => ({
          contents: `
            export class TFile {
              constructor(path) {
                this.path = path;
                this.extension = path.includes('.') ? path.split('.').pop() : '';
                this.basename = path.split('/').pop().replace(/\\.[^.]+$/, '');
              }
              static [Symbol.hasInstance](value) {
                return Boolean(value && typeof value.path === 'string' && typeof value.extension === 'string');
              }
            }
            export class Modal {
              constructor(app) {
                this.app = app;
                this.contentEl = { empty() {}, createEl() { return {}; } };
              }
              open() {}
              close() {}
            }
            export class Component {
              load() {}
              unload() {}
            }
            export const MarkdownRenderer = {
              async render(app, content, el, path, component) {}
            };
            export class Notice {
              constructor(message) {
                globalThis.__notices = [...(globalThis.__notices || []), message];
              }
            }
            export function normalizePath(path) { return String(path || '').replace(/\\\\/g, '/'); }
            export function setIcon() {}
          `,
          loader: 'js',
        }));
      },
    }],
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function installMomentStub() {
  const fixedNow = new Date(2026, 6, 4, 12, 34, 0);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (value) => String(value).padStart(2, '0');
  const parseDate = (value) => {
    if (value instanceof Date) return new Date(value.getTime());
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return new Date(fixedNow.getTime());
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0);
  };
  const wrap = (source) => {
    const date = parseDate(source);
    return {
      clone: () => wrap(date),
      startOf: (unit) => {
        if (unit === 'day') date.setHours(0, 0, 0, 0);
        return wrap(date);
      },
      format: (format) => String(format || '')
        .replace('YYYY', String(date.getFullYear()))
        .replace('MMM', months[date.getMonth()])
        .replace('MM', pad(date.getMonth() + 1))
        .replace('DD', pad(date.getDate()))
        .replace('HH', pad(date.getHours()))
        .replace('mm', pad(date.getMinutes()))
        .replace('ss', pad(date.getSeconds()))
        .replace('ddd', weekdays[date.getDay()]),
      toDate: () => new Date(date.getTime()),
    };
  };
  globalThis.window = { moment: (value) => (value === undefined ? wrap(fixedNow) : wrap(value)) };
}

function createPluginHarness({
  existingFiles = {},
  dailyNotes = {},
  activeFilePath = '',
  dailyNoteTemplateContent = null,
} = {}) {
  const files = new Map(Object.entries(existingFiles));
  const folders = new Set();
  const opened = [];
  const dailyNoteEnsures = [];
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.md$/, '');
    }
  }
  const plugin = {
    settings: {
      homeCaptureInsertPosition: 'bottom',
      homeCaptureAddHeading: false,
      homeCaptureHeading: 'Capture',
    },
    app: {
      internalPlugins: {
        plugins: {
          'daily-notes': {
            instance: {
              options: dailyNotes,
            },
          },
        },
      },
      workspace: {
        getLeaf: () => ({ id: 'leaf' }),
        getActiveFile: () => activeFilePath ? new FakeFile(activeFilePath) : null,
      },
      metadataCache: {
        getTags: () => ({ '#home': 2, '#health/workout': 1 }),
      },
      vault: {
        getAbstractFileByPath(path) {
          if (files.has(path)) return new FakeFile(path);
          if (folders.has(path)) return { path };
          return null;
        },
        async createFolder(path) {
          folders.add(path);
        },
        async create(path, content) {
          files.set(path, content);
          return new FakeFile(path);
        },
        async read(file) {
          return files.get(file.path) || '';
        },
        async cachedRead(file) {
          return files.get(file.path) || '';
        },
        async modify(file, content) {
          files.set(file.path, content);
        },
        async process(file, mutator) {
          const current = files.get(file.path) || '';
          const next = await mutator(current);
          files.set(file.path, next);
          return next;
        },
      },
    },
    async openFileInLeaf(file, preview, leafFactory, options) {
      opened.push({ file: file.path, preview, leaf: leafFactory?.(), options });
    },
  };
  plugin.noteOperationService = {
    async ensureDailyNote(dateValue) {
      const isoDate = String(dateValue || '').slice(0, 10);
      dailyNoteEnsures.push(isoDate);
      const date = window.moment(isoDate);
      const format = String(dailyNotes.format || '').trim() || 'YYYY-MM-DD';
      const folder = String(dailyNotes.folder || '').trim().replace(/^\/+|\/+$/g, '');
      const path = `${folder ? `${folder}/` : ''}${date.format(format)}.md`;
      if (!files.has(path)) {
        const parts = folder.split('/').filter(Boolean);
        let current = '';
        for (const part of parts) {
          current = current ? `${current}/${part}` : part;
          folders.add(current);
        }
        files.set(
          path,
          dailyNoteTemplateContent
            ?? `---\nscheduled: ${isoDate} 00:00:00\n---\n\n`,
        );
      }
      return new FakeFile(path);
    },
  };
  return { plugin, files, folders, opened, dailyNoteEnsures };
}

const { HomeCaptureService, classifyHomeCaptureLineHistoryAction } = await loadCaptureServiceModule();

test('Home line-editor history classifies task updates and task/bullet conversions', () => {
  assert.equal(classifyHomeCaptureLineHistoryAction('- [ ] Task', '- [x] Task'), 'task.update');
  assert.equal(classifyHomeCaptureLineHistoryAction('- [ ] Task', '- Bullet'), 'task.delete');
  assert.equal(classifyHomeCaptureLineHistoryAction('- Bullet', '- [ ] Task'), 'task.create');
  assert.equal(classifyHomeCaptureLineHistoryAction('- Bullet', '- Changed bullet'), null);
  assert.equal(classifyHomeCaptureLineHistoryAction('- [ ] Task', '- [ ] Task'), null);
});

test('Home capture writes selected-day daily notes through Daily Notes settings', async () => {
  installMomentStub();
  const { plugin, files, folders } = createPluginHarness({
    dailyNotes: {
      folder: 'Inbox/TPS Home QA',
      format: 'YYYY-MM-DD',
    },
  });
  const service = new HomeCaptureService(plugin);

  const file = await service.capture('Alpha\nBeta', window.moment('2026-07-08'));

  assert.equal(file.path, 'Inbox/TPS Home QA/2026-07-08.md');
  assert.equal(folders.has('Inbox'), true);
  assert.equal(folders.has('Inbox/TPS Home QA'), true);
  assert.equal(
    files.get('Inbox/TPS Home QA/2026-07-08.md'),
    [
      '---',
      'scheduled: 2026-07-08 00:00:00',
      '---',
      '',
      '- Alpha %% tps-inline-props:{"createdDate":"2026-07-04 12:34:00"} %%',
      '- Beta %% tps-inline-props:{"createdDate":"2026-07-04 12:34:00"} %%',
      '',
    ].join('\n'),
  );
  assert.deepEqual(globalThis.__notices.slice(-1), ['Added to 2026-07-08.']);
});

test('Home capture delegates creation and preserves the complete Daily Notes template', async () => {
  installMomentStub();
  const template = [
    '---',
    'title: Wednesday planning',
    'kind: dailynote',
    '---',
    '',
    '# Plan',
    '',
    'Template body',
    '',
  ].join('\n');
  const { plugin, files, dailyNoteEnsures } = createPluginHarness({
    dailyNotes: {
      folder: 'Inbox/TPS Home QA',
      format: 'YYYY-MM-DD',
    },
    dailyNoteTemplateContent: template,
  });
  const service = new HomeCaptureService(plugin);

  const file = await service.capture('Preserve the template', window.moment('2026-07-08'));

  assert.equal(file.path, 'Inbox/TPS Home QA/2026-07-08.md');
  assert.deepEqual(dailyNoteEnsures, ['2026-07-08']);
  assert.equal(
    files.get(file.path),
    `${template}\n- Preserve the template %% tps-inline-props:{"createdDate":"2026-07-04 12:34:00"} %%\n`,
  );
  const ensureMethod = globalThis.__homeCaptureServiceSource.match(
    /private async ensureDailyNote\(date: any\): Promise<TFile> \{([\s\S]*?)\n  \}/u,
  )?.[1] ?? '';
  assert.match(ensureMethod, /noteOperationService\.ensureDailyNote/u);
  assert.doesNotMatch(ensureMethod, /vault\.create/u);
});

test('Home capture stores createdDate on every root Markdown line and leaves nested descendants unstamped', async () => {
  installMomentStub();
  const { plugin, files } = createPluginHarness({
    dailyNotes: {
      folder: 'Inbox/TPS Home QA',
      format: 'YYYY-MM-DD',
    },
  });
  const service = new HomeCaptureService(plugin);

  const file = await service.capture(
    '- First root\n  - Nested child\n    - Nested grandchild\n- [ ] Second root\n\nPlain root',
    window.moment('2026-07-09'),
    { preserveMarkdown: true },
  );

  assert.equal(
    files.get(file.path),
    [
      '---',
      'scheduled: 2026-07-09 00:00:00',
      '---',
      '',
      '- First root %% tps-inline-props:{"createdDate":"2026-07-04 12:34:00"} %%',
      '  - Nested child',
      '    - Nested grandchild',
      '- [ ] Second root %% tps-inline-props:{"createdDate":"2026-07-04 12:34:00"} %%',
      '',
      'Plain root %% tps-inline-props:{"createdDate":"2026-07-04 12:34:00"} %%',
      '',
    ].join('\n'),
  );
});

test('Home capture writes an explicit current-note target under the selected heading atomically', async () => {
  installMomentStub();
  const path = 'Inbox/Current Capture.md';
  const source = '# Current\n\n## Inbox\n\nExisting\n\n### Nested\n\nNested body\n\n## Later\n';
  const { plugin, files } = createPluginHarness({ existingFiles: { [path]: source } });
  const service = new HomeCaptureService(plugin);

  const file = await service.capture('- Added from command', window.moment('2026-07-09'), {
    targetPath: path,
    preserveMarkdown: true,
    headingTarget: { line: 2, level: 2, text: 'Inbox', occurrence: 0, matchingCount: 1 },
  });

  assert.equal(file.path, path);
  assert.equal(files.get(path), [
    '# Current',
    '',
    '## Inbox',
    '',
    'Existing',
    '',
    '### Nested',
    '',
    'Nested body',
    '',
    '- Added from command %% tps-inline-props:{"createdDate":"2026-07-04 12:34:00"} %%',
    '',
    '## Later',
    '',
  ].join('\n'));
  assert.deepEqual(globalThis.__notices.slice(-1), ['Added to Current Capture.']);
});

test('current-note capture guards non-Markdown state and routes an active Markdown file explicitly', async () => {
  installMomentStub();
  globalThis.__notices = [];
  const unavailable = createPluginHarness({ activeFilePath: 'Attachments/Capture.png' });
  const unavailableService = new HomeCaptureService(unavailable.plugin);
  assert.equal(await unavailableService.openCaptureModalForCurrentNote(), false);
  assert.deepEqual(globalThis.__notices, ['TPS GCM: Open a Markdown note before capturing to the current note.']);

  const path = 'Inbox/Current Capture.md';
  const available = createPluginHarness({
    activeFilePath: path,
    existingFiles: { [path]: '# Current\n\n## Inbox\n' },
  });
  const availableService = new HomeCaptureService(available.plugin);
  const routed = [];
  availableService.openCaptureModalForTarget = async (file, date, options, targetLabel) => {
    routed.push({ path: file?.path, date: date.format('YYYY-MM-DD'), options, targetLabel });
    return true;
  };
  assert.equal(await availableService.openCaptureModalForCurrentNote(), true);
  assert.deepEqual(routed, [{
    path,
    date: '2026-07-04',
    options: {},
    targetLabel: path,
  }]);
});

test('Home capture refuses a stale selected heading without changing the target note', async () => {
  installMomentStub();
  const path = 'Inbox/Stale Capture.md';
  const source = '# Current\n\n## Renamed\n\nExisting\n';
  const { plugin, files } = createPluginHarness({ existingFiles: { [path]: source } });
  const service = new HomeCaptureService(plugin);

  const file = await service.capture('- Must not write', window.moment('2026-07-09'), {
    targetPath: path,
    preserveMarkdown: true,
    headingTarget: { line: 2, level: 2, text: 'Inbox', occurrence: 0, matchingCount: 1 },
  });

  assert.equal(file, null);
  assert.equal(files.get(path), source);
  assert.deepEqual(globalThis.__notices.slice(-1), [
    'The selected heading changed or no longer exists. Nothing was written.',
  ]);
});

test('Home capture can write selected-day daily notes as unchecked tasks', async () => {
  installMomentStub();
  const { plugin, files } = createPluginHarness({
    dailyNotes: {
      folder: 'Inbox/TPS Home QA',
      format: 'YYYY-MM-DD',
    },
  });
  const service = new HomeCaptureService(plugin);

  const file = await service.capture('Call HVAC', window.moment('2026-07-10'), { task: true });

  assert.equal(file.path, 'Inbox/TPS Home QA/2026-07-10.md');
  assert.equal(
    files.get('Inbox/TPS Home QA/2026-07-10.md'),
    [
      '---',
      'scheduled: 2026-07-10 00:00:00',
      '---',
      '',
      '- [ ] Call HVAC %% tps-inline-props:{"createdDate":"2026-07-04 12:34:00"} %%',
      '',
    ].join('\n'),
  );
  assert.deepEqual(globalThis.__notices.slice(-1), ['Added task to 2026-07-10.']);
});

test('explicit Home task captures inject stable identities atomically and commit exact saved locators', async () => {
  installMomentStub();
  const { plugin, files } = createPluginHarness({
    dailyNotes: {
      folder: 'Inbox/TPS Home QA',
      format: 'YYYY-MM-DD',
    },
  });
  const history = [];
  let sequence = 0;
  plugin.itemHistoryService = {
    async beginTaskMutation(input) {
      sequence += 1;
      history.push({ type: 'begin', input: structuredClone(input) });
      return { operationId: `op-${sequence}`, entityId: `home-${sequence}` };
    },
    ensureTaskIdentity(handle, line) {
      history.push({ type: 'ensure', entityId: handle.entityId });
      return `${line} [tpsId:: ${handle.entityId}]`;
    },
    async commitTaskMutation(handle, input) {
      history.push({ type: 'commit', entityId: handle.entityId, input: structuredClone(input) });
    },
    async abortTaskMutation(handle) {
      history.push({ type: 'abort', entityId: handle.entityId });
    },
  };
  const service = new HomeCaptureService(plugin);

  const file = await service.capture('Call HVAC\nBook inspection', window.moment('2026-07-10'), {
    task: true,
    historyCause: {
      kind: 'user',
      sourcePluginId: 'tps-global-context-menu',
      surface: 'home-quick-capture-mobile',
    },
  });

  const saved = files.get(file.path);
  assert.match(saved, /- \[ \] Call HVAC .*\[tpsId:: home-1\]/u);
  assert.match(saved, /- \[ \] Book inspection .*\[tpsId:: home-2\]/u);
  assert.deepEqual(history.map((event) => event.type), [
    'begin',
    'begin',
    'ensure',
    'ensure',
    'commit',
    'commit',
  ]);
  const commits = history.filter((event) => event.type === 'commit');
  assert.equal(commits.length, 2);
  for (const commit of commits) {
    assert.equal(
      saved.split('\n')[commit.input.after.lineNumber],
      commit.input.after.rawLine,
      'history must commit the exact line saved in the Daily Note',
    );
    assert.equal(commit.input.outcome, 'committed');
  }
  assert.equal(history.filter((event) => event.type === 'abort').length, 0);
});

test('Home task history failures stay fail-open while plain captures remain untracked', async () => {
  installMomentStub();
  const { plugin, files } = createPluginHarness({
    dailyNotes: {
      folder: 'Inbox/TPS Home QA',
      format: 'YYYY-MM-DD',
    },
  });
  const history = [];
  plugin.itemHistoryService = {
    async beginTaskMutation() {
      history.push('begin');
      return { operationId: 'op-fail-open', entityId: 'home-fail-open' };
    },
    ensureTaskIdentity() {
      history.push('ensure');
      throw new Error('synthetic identity failure');
    },
    async commitTaskMutation() {
      history.push('commit');
    },
    async abortTaskMutation() {
      history.push('abort');
    },
  };
  const service = new HomeCaptureService(plugin);
  const cause = {
    kind: 'user',
    sourcePluginId: 'tps-global-context-menu',
    surface: 'home-quick-capture-mobile',
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  let taskFile;
  try {
    taskFile = await service.capture('Fail-open task', window.moment('2026-07-13'), {
      task: true,
      historyCause: cause,
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.match(files.get(taskFile.path), /- \[ \] Fail-open task/u);
  assert.doesNotMatch(files.get(taskFile.path), /tpsId::/u);
  assert.deepEqual(history, ['begin', 'ensure', 'abort']);

  history.length = 0;
  await service.capture('Plain note', window.moment('2026-07-13'), { historyCause: cause });
  assert.deepEqual(history, [], 'explicit user metadata must not turn a plain capture into task history');
});

test('Daily note preview maps formatted and ID-bearing historical rows to exact Quick Capture lines', () => {
  installMomentStub();
  const { plugin } = createPluginHarness();
  const service = new HomeCaptureService(plugin);
  const createElement = (text, isTask = false) => {
    const listeners = new Map();
    const attributes = new Map();
    const classes = new Set();
    return {
      dataset: {},
      textContent: text,
      listeners,
      attributes,
      classes,
      closest(selector) {
        if (selector === '[data-line]' && this.dataset.line !== undefined) return this;
        return null;
      },
      matches(selector) {
        return isTask && selector === 'li.task-list-item';
      },
      querySelector() {
        return null;
      },
      addClass(value) {
        classes.add(value);
      },
      setAttr(name, value) {
        attributes.set(name, value);
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
    };
  };
  const first = createElement('Existing plain 12:33');
  const finalFormatted = createElement('TPS_CAPTURE_QA_20260711 bold #qa 12:34');
  const historicalTask = createElement(
    'Historical reminder [tpsId:: task-m8yzcj] %% tps-inline-props:{"externalId":"reminders:old"} %%',
    true,
  );
  const legacySubitemTask = createElement('Legacy child [subitemId:: legacy-child]', true);
  const body = {
    querySelectorAll() {
      return [first, finalFormatted, historicalTask, legacySubitemTask];
    },
  };
  const clicks = [];
  const file = { path: '2026-07-11.md' };

  service.enableDailyNoteLineLoading(
    body,
    file,
    [
      '- Existing plain 12:33',
      '- TPS_CAPTURE_QA_20260711 **bold** #qa 12:34',
      '- [ ] Historical reminder [tpsId:: task-m8yzcj] %% tps-inline-props:{"externalId":"reminders:old"} %%',
      '- [ ] Legacy child [subitemId:: legacy-child]',
      '',
    ].join('\n'),
    (_file, line) => clicks.push(line),
  );

  assert.equal(finalFormatted.attributes.get('title'), 'Edit this line in Quick Capture');
  assert.equal(finalFormatted.classes.has('tps-home-daily-note-load-line'), true);
  let prevented = false;
  let stopped = false;
  finalFormatted.listeners.get('click')({
    target: finalFormatted,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
  });
  assert.deepEqual(clicks, [1]);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(historicalTask.dataset.taskPath, '2026-07-11.md');
  assert.equal(historicalTask.dataset.taskLine, '3');
  assert.equal(historicalTask.dataset.taskText, 'Historical reminder');
  assert.equal(legacySubitemTask.dataset.taskLine, '4');
  assert.equal(legacySubitemTask.dataset.taskText, 'Legacy child');
  assert.equal(historicalTask.attributes.has('title'), false);
  assert.equal(historicalTask.classes.has('tps-home-daily-note-load-line'), false);
  assert.equal(historicalTask.listeners.has('click'), false);
  assert.equal(legacySubitemTask.attributes.has('title'), false);
  assert.equal(legacySubitemTask.classes.has('tps-home-daily-note-load-line'), false);
  assert.equal(legacySubitemTask.listeners.has('click'), false);
  assert.deepEqual(clicks, [1]);
});

test('Home capture ignores legacy heading settings and writes into the daily note body', async () => {
  installMomentStub();
  const { plugin, files } = createPluginHarness({
    dailyNotes: {
      folder: 'Inbox/TPS Home QA',
      format: 'YYYY-MM-DD',
    },
  });
  plugin.settings.homeCaptureAddHeading = true;
  plugin.settings.homeCaptureHeading = 'Capture';
  const service = new HomeCaptureService(plugin);

  const file = await service.capture('Body only', window.moment('2026-07-12'));

  assert.equal(file.path, 'Inbox/TPS Home QA/2026-07-12.md');
  assert.equal(
    files.get('Inbox/TPS Home QA/2026-07-12.md'),
    [
      '---',
      'scheduled: 2026-07-12 00:00:00',
      '---',
      '',
      '- Body only %% tps-inline-props:{"createdDate":"2026-07-04 12:34:00"} %%',
      '',
    ].join('\n'),
  );
  assert.equal(files.get('Inbox/TPS Home QA/2026-07-12.md').includes('## Capture'), false);
});

test('Home capture rejects Markdown headings before writing', async () => {
  installMomentStub();
  const { plugin, files } = createPluginHarness({
    dailyNotes: {
      folder: 'Inbox/TPS Home QA',
      format: 'YYYY-MM-DD',
    },
  });
  const service = new HomeCaptureService(plugin);

  const file = await service.capture('# Not allowed\nBody', window.moment('2026-07-11'));

  assert.equal(file, null);
  assert.equal(files.has('Inbox/TPS Home QA/2026-07-11.md'), false);
  assert.deepEqual(globalThis.__notices.slice(-1), ['Quick capture does not support headings yet.']);
});

test('Home capture exposes the selected daily note and no separate draft note', () => {
  const source = globalThis.__homeCaptureServiceSource;
  assert.doesNotMatch(source, /HOME_CAPTURE_DRAFT_PATH/);
  assert.match(source, /getDailyNoteForCapture/);
  assert.match(source, /formatCaptureValue/);
  assert.match(source, /getWikilinkSuggestionsBeforeCursor/);
  assert.match(source, /endsWith\('\['\)/);
  assert.match(source, /openCaptureModalForCurrentNote/);
  assert.match(source, /listHomeCaptureHeadings/);
  assert.match(source, /Capture destination section/);
  assert.match(source, /headingTarget: selectedHeadingTarget/);
  assert.match(source, /openCaptureModalForContext/);
});

test('capture line editors hide and preserve GCM inline-property carriers', () => {
  const serviceSource = globalThis.__homeCaptureServiceSource;
  const homeSource = globalThis.__homeViewSource;
  assert.match(serviceSource, /initialValue: stripTaskInlinePropsMetadata\(this\.snapshot\.value\)/u);
  assert.match(serviceSource, /preserveTpsInlinePropsMetadata\(this\.snapshot\.value, value\.trim\(\)\)/u);
  assert.match(homeSource, /textarea\.value = editSnapshot \? stripTaskInlinePropsMetadata\(editSnapshot\.value\) : ''/u);
  assert.match(homeSource, /preserveTpsInlinePropsMetadata\(editSnapshot\.value, value\)/u);
  assert.match(homeSource, /preserveTpsInlinePropsMetadata\(originalEditLine, value\)/u);
});

test('capture commands explicitly distinguish today, current note, and contextual Home targets', () => {
  const source = globalThis.__gcmCommandSource;
  assert.match(source, /id: 'home-quick-capture'[\s\S]*name: "Capture: Today's Daily Note"/u);
  assert.match(source, /id: 'capture-to-current-note'[\s\S]*name: 'Capture: Current note'/u);
  assert.match(source, /openCaptureModalForCurrentNote\(\)/u);
  assert.match(source, /id: 'capture-to-home-note'[\s\S]*Home: Capture to selected Daily Note/u);
});

test('Home selected-day note opens through the shared focused opener', async () => {
  installMomentStub();
  const { plugin, opened } = createPluginHarness({
    existingFiles: {
      '2026-07-09.md': '# Existing\n',
    },
  });
  const service = new HomeCaptureService(plugin);

  await service.openDailyNote(window.moment('2026-07-09'));

  assert.deepEqual(opened, [{
    file: '2026-07-09.md',
    preview: false,
    leaf: { id: 'leaf' },
    options: { revealLeaf: true },
  }]);
});
