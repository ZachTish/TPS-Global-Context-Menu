import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

globalThis.__homeCaptureServiceSource = readFileSync(new URL('../src/services/home-capture-service.ts', import.meta.url), 'utf8');

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
        .replace('ddd', weekdays[date.getDay()]),
      toDate: () => new Date(date.getTime()),
    };
  };
  globalThis.window = { moment: (value) => (value === undefined ? wrap(fixedNow) : wrap(value)) };
}

function createPluginHarness({ existingFiles = {}, dailyNotes = {} } = {}) {
  const files = new Map(Object.entries(existingFiles));
  const folders = new Set();
  const opened = [];
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
  return { plugin, files, folders, opened };
}

const { HomeCaptureService } = await loadCaptureServiceModule();

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
      '- Alpha 12:34',
      '- Beta 12:34',
      '',
    ].join('\n'),
  );
  assert.deepEqual(globalThis.__notices.slice(-1), ['Added to 2026-07-08.']);
});

test('Home capture timestamps every root Markdown line and leaves nested descendants unstamped', async () => {
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
      '- First root 12:34',
      '  - Nested child',
      '    - Nested grandchild',
      '- [ ] Second root 12:34',
      '',
      'Plain root 12:34',
      '',
    ].join('\n'),
  );
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
      '- [ ] Call HVAC 12:34',
      '',
    ].join('\n'),
  );
  assert.deepEqual(globalThis.__notices.slice(-1), ['Added task to 2026-07-10.']);
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
      '- Body only 12:34',
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
  assert.match(source, /new HomeCaptureModal\(this\.plugin, this, date, options\)\.open\(\)/);
  assert.match(source, /openCaptureModalForContext/);
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
