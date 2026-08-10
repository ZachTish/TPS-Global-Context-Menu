import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

async function loadDailyNoteCreationUtilities() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/daily-note-creation.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadDailyNoteTaskSchedule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/daily-note-task-schedule.ts', import.meta.url))],
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
            export class App {}
            export class TFile {
              constructor(path) {
                this.path = path;
                this.basename = path.split('/').pop().replace(/\\.[^.]+$/, '');
              }
              static [Symbol.hasInstance](value) {
                return Boolean(value && typeof value.path === 'string');
              }
            }
            const momentFactory = (value, formats) => {
              const accepted = Array.isArray(formats) ? formats : [formats];
              const text = String(value || '');
              const match = text.match(/^(\\d{4})\\/(\\d{2})\\/(\\d{2})$/);
              const valid = Boolean(match && accepted.includes('YYYY/MM/DD'));
              return {
                isValid: () => valid,
                format: (pattern) => pattern === 'YYYY-MM-DD' && match
                  ? \`\${match[1]}-\${match[2]}-\${match[3]}\`
                  : text,
              };
            };
            momentFactory.ISO_8601 = Symbol('ISO_8601');
            momentFactory.invalid = () => ({ isValid: () => false, format: () => '' });
            export const moment = momentFactory;
            export function normalizePath(path) {
              return String(path || '').replace(/\\\\/g, '/').replace(/\\/+/g, '/').replace(/^\\//, '');
            }
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadNoteOperationService() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/note-operation-service.ts', import.meta.url))],
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
            export class App {}
            export class TFile {
              constructor(path) {
                this.path = path;
                this.extension = path.split('.').pop();
                this.basename = path.split('/').pop().replace(/\\.[^.]+$/, '');
                const slash = path.lastIndexOf('/');
                this.parent = { path: slash >= 0 ? path.slice(0, slash) : '/' };
              }
              static [Symbol.hasInstance](value) {
                return Boolean(value && typeof value.path === 'string' && typeof value.basename === 'string');
              }
            }
            export class Notice {
              constructor(message) {
                globalThis.__dailyNoteNotices = [...(globalThis.__dailyNoteNotices || []), String(message)];
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
            export class FuzzySuggestModal extends Modal {
              setPlaceholder() {}
              getItems() { return []; }
            }
            export function normalizePath(path) {
              return String(path || '').replace(/\\\\/g, '/').replace(/\\/+/g, '/').replace(/^\\//, '');
            }
            export function parseYaml() { return {}; }
            export function stringifyYaml(value) { return JSON.stringify(value); }
            export const moment = Object.assign(() => null, { ISO_8601: Symbol('ISO_8601') });
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function installDailyNoteMoment() {
  const pad = (value) => String(value).padStart(2, '0');
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const factory = (value) => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    const date = value == null
      ? new Date(2026, 6, 28, 14, 45, 0)
      : match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 30, 0)
      : new Date(Number.NaN);
    return {
      isValid: () => !Number.isNaN(date.getTime()),
      format: (pattern) => String(pattern || '')
        .replace('YYYY', String(date.getFullYear()))
        .replace('MM', pad(date.getMonth() + 1))
        .replace('DD', pad(date.getDate()))
        .replace('dddd', weekdays[date.getDay()])
        .replace('HH', pad(date.getHours()))
        .replace('mm', pad(date.getMinutes())),
    };
  };
  factory.ISO_8601 = Symbol('ISO_8601');
  globalThis.window = { moment: factory };
}

function createDailyNoteServiceHarness(TFile, {
  templatePath = 'Templates/Daily',
  templateContent = [
    '---',
    'title: "{{date:dddd}} planning"',
    'kind: dailynote',
    'scheduled: "{{date}} 00:00:00"',
    '---',
    '',
    '# Template section',
    '',
    '<% daily-body %>',
    '',
  ].join('\n'),
  runtimeDailyNotes = {
    folder: 'Daily',
    format: 'YYYY-MM-DD',
    template: templatePath,
  },
  runtimeDailyNotesEnabled = true,
  periodicDailyNotes = null,
  persistedDailyNotes = null,
  runtimeTemplates = null,
  persistedTemplates = null,
  templaterAutoTrigger = false,
  templaterLocalAutoTrigger,
  templaterAutoHookDelayMs = 20,
  templaterAutoHookWriteDelayMs = 50,
  simulateCreateRace = false,
} = {}) {
  const files = new Map();
  const fileTimes = new Map();
  const folders = new Set(['']);
  const templaterPendingFiles = new Set();
  const autoHookPromises = [];
  let createCount = 0;
  let templaterRuns = 0;
  let templaterAutoRuns = 0;
  let templaterExplicitRuns = 0;
  if (templateContent !== null) {
    files.set('Templates/Daily.md', templateContent);
    fileTimes.set('Templates/Daily.md', Date.now() - 10_000);
  }
  const effectiveTemplaterAutoTrigger = typeof templaterLocalAutoTrigger === 'boolean'
    ? templaterLocalAutoTrigger
    : templaterAutoTrigger;
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const applyTemplaterCommands = (content) => String(content || '')
    .replace('<% daily-body %>', 'Templater body');
  const scheduleTemplaterAutoHook = (path) => {
    if (!effectiveTemplaterAutoTrigger) return;
    const autoHook = (async () => {
      await delay(templaterAutoHookDelayMs);
      templaterPendingFiles.add(path);
      const snapshot = files.get(path);
      await delay(templaterAutoHookWriteDelayMs);
      templaterRuns += 1;
      templaterAutoRuns += 1;
      files.set(path, applyTemplaterCommands(snapshot));
      templaterPendingFiles.delete(path);
    })();
    autoHookPromises.push(autoHook);
  };

  const parseFrontmatter = (content) => {
    const normalized = String(content || '').replace(/\r\n/g, '\n');
    if (!normalized.startsWith('---\n')) return { frontmatter: {}, body: normalized };
    const end = normalized.indexOf('\n---', 4);
    if (end < 0) return { frontmatter: {}, body: normalized };
    const frontmatter = {};
    for (const line of normalized.slice(4, end).split('\n')) {
      const match = line.match(/^([^:#]+):\s*(.*)$/);
      if (!match) continue;
      let value = match[2].trim();
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      frontmatter[match[1].trim()] = value;
    }
    return { frontmatter, body: normalized.slice(end + 4) };
  };
  const writeFrontmatter = (frontmatter, body) => {
    const yaml = Object.entries(frontmatter)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join('\n');
    return `---\n${yaml}\n---${body}`;
  };
  const fileFor = (path) => {
    if (!files.has(path)) return null;
    const file = new TFile(path);
    const timestamp = fileTimes.get(path) ?? (Date.now() - 10_000);
    file.stat = {
      ctime: timestamp,
      mtime: timestamp,
      size: String(files.get(path) || '').length,
    };
    return file;
  };

  const app = {
    loadLocalStorage(key) {
      if (key === 'templater-local-settings' && typeof templaterLocalAutoTrigger === 'boolean') {
        return { trigger_on_file_creation: templaterLocalAutoTrigger };
      }
      return undefined;
    },
    internalPlugins: {
      getPluginById(id) {
        if (id === 'daily-notes' && runtimeDailyNotes !== null) {
          return {
            enabled: runtimeDailyNotesEnabled,
            instance: {
              options: runtimeDailyNotes,
            },
          };
        }
        if (id === 'templates' && runtimeTemplates !== null) {
          return {
            enabled: true,
            instance: {
              options: runtimeTemplates,
            },
          };
        }
        return null;
      },
      plugins: {},
    },
    plugins: {
      getPlugin(id) {
        return id === 'periodic-notes' && periodicDailyNotes !== null
          ? { settings: { daily: periodicDailyNotes } }
          : null;
      },
      plugins: {
        'templater-obsidian': {
          settings: {
            trigger_on_file_creation: templaterAutoTrigger,
          },
          templater: {
            files_with_pending_templates: templaterPendingFiles,
            async overwrite_file_commands(file) {
              templaterRuns += 1;
              templaterExplicitRuns += 1;
              files.set(file.path, applyTemplaterCommands(files.get(file.path)));
            },
          },
        },
      },
    },
    metadataCache: {
      getFirstLinkpathDest: () => null,
      getFileCache(file) {
        return { frontmatter: parseFrontmatter(files.get(file.path) || '').frontmatter };
      },
    },
    vault: {
      configDir: '.obsidian',
      adapter: {
        async exists(path) {
          return files.has(path) || folders.has(path);
        },
        async read(path) {
          if (path === '.obsidian/daily-notes.json' && persistedDailyNotes) {
            return JSON.stringify(persistedDailyNotes);
          }
          if (path === '.obsidian/templates.json' && persistedTemplates) {
            return JSON.stringify(persistedTemplates);
          }
          if (!files.has(path)) throw new Error(`Missing file: ${path}`);
          return files.get(path);
        },
      },
      getAbstractFileByPath(path) {
        return fileFor(path) ?? (folders.has(path) ? { path } : null);
      },
      getMarkdownFiles() {
        return Array.from(files.keys()).filter((path) => path.endsWith('.md')).map((path) => fileFor(path));
      },
      async read(file) {
        return files.get(file.path);
      },
      async cachedRead(file) {
        return files.get(file.path);
      },
      async createFolder(path) {
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        if (parent && !folders.has(parent)) throw new Error(`Missing parent folder: ${parent}`);
        folders.add(path);
      },
      async create(path, content) {
        await Promise.resolve();
        if (files.has(path)) throw new Error(`File already exists: ${path}`);
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        if (parent && !folders.has(parent)) throw new Error(`Missing parent folder: ${parent}`);
        createCount += 1;
        files.set(path, content);
        fileTimes.set(path, Date.now());
        scheduleTemplaterAutoHook(path);
        if (simulateCreateRace) {
          throw new Error(`File already exists: ${path}`);
        }
        return fileFor(path);
      },
      async modify(file, content) {
        files.set(file.path, content);
      },
    },
    fileManager: {
      async processFrontMatter(file, mutator) {
        const parsed = parseFrontmatter(files.get(file.path) || '');
        mutator(parsed.frontmatter);
        files.set(file.path, writeFrontmatter(parsed.frontmatter, parsed.body));
      },
    },
  };
  let nativeProcessFrontMatterCalls = 0;
  const processOwnedFrontmatter = async (file, mutator) => {
    const parsed = parseFrontmatter(files.get(file.path) || '');
    await mutator(parsed.frontmatter);
    files.set(file.path, writeFrontmatter(parsed.frontmatter, parsed.body));
    return true;
  };
  app.fileManager.processFrontMatter = async () => {
    nativeProcessFrontMatterCalls += 1;
    throw new Error('Daily-note creation bypassed the owned frontmatter mutation service.');
  };
  const plugin = {
    app,
    settings: { autoSaveFolderPath: false },
    frontmatterMutationService: {
      process: processOwnedFrontmatter,
    },
    fileNamingService: {
      registerDailyNoteConfiguration() {},
      async processFileOnOpen() {},
    },
    notebookNavigatorRuleService: { async applyRulesToFile() {} },
  };
  return {
    plugin,
    files,
    seedExternalCreation(path, content) {
      files.set(path, content);
      fileTimes.set(path, Date.now());
      scheduleTemplaterAutoHook(path);
      return fileFor(path);
    },
    async waitForAutoHooks() {
      await Promise.all(autoHookPromises);
    },
    stats: {
      get createCount() { return createCount; },
      get templaterRuns() { return templaterRuns; },
      get templaterAutoRuns() { return templaterAutoRuns; },
      get templaterExplicitRuns() { return templaterExplicitRuns; },
      get nativeProcessFrontMatterCalls() { return nativeProcessFrontMatterCalls; },
    },
  };
}

const {
  applyCoreDailyNoteTemplateVariables,
  ensureDailyNoteTitleFallback,
  getDailyNotePathDateCandidate,
} = await loadDailyNoteCreationUtilities();

test('Daily Note titles remain owned by the template or user', () => {
  const readable = { title: 'Tuesday planning' };
  assert.equal(ensureDailyNoteTitleFallback(readable, 'Tue, Jul 28 2026'), false);
  assert.deepEqual(readable, { title: 'Tuesday planning' });

  const differentlyCased = { Title: 'Readable Daily Note' };
  assert.equal(ensureDailyNoteTitleFallback(differentlyCased, '2026-07-28'), false);
  assert.deepEqual(differentlyCased, { Title: 'Readable Daily Note' });

  const templaterPending = { title: '<% tp.date.now("dddd, MMMM D") %>' };
  assert.equal(ensureDailyNoteTitleFallback(templaterPending, '2026-07-28'), false);
  assert.equal(templaterPending.title, '<% tp.date.now("dddd, MMMM D") %>');
});

test('Daily Note title fallback fills only missing or blank titles', () => {
  const missing = { kind: 'dailynote' };
  assert.equal(ensureDailyNoteTitleFallback(missing, 'Tue, Jul 28 2026'), true);
  assert.equal(missing.title, 'Tue, Jul 28 2026');

  const blank = { Title: '   ', kind: 'dailynote' };
  assert.equal(ensureDailyNoteTitleFallback(blank, 'Tue, Jul 28 2026'), true);
  assert.deepEqual(blank, { Title: 'Tue, Jul 28 2026', kind: 'dailynote' });
});

test('manual Daily Note template copies expand core variables and preserve Templater expressions', () => {
  const date = {
    format(pattern) {
      const values = {
        'YYYY-MM-DD': '2026-07-28',
        'HH:mm': '09:30',
        dddd: 'Tuesday',
        'MMMM D, YYYY': 'July 28, 2026',
      };
      return values[pattern] ?? `<${pattern}>`;
    },
  };
  const source = [
    'title: "{{date:dddd}} planning"',
    'day: {{date}}',
    'time: {{time}}',
    'long: {{date:MMMM D, YYYY}}',
    'file: {{title}}',
    'templater: <% tp.date.now("YYYY-MM-DD") %>',
  ].join('\n');
  const currentTime = {
    format(pattern) {
      return {
        'HH:mm': '14:45',
        'HH.mm': '14.45',
      }[pattern] ?? `<current:${pattern}>`;
    },
  };
  assert.equal(
    applyCoreDailyNoteTemplateVariables(
      source,
      date,
      'Tue, Jul 28 2026',
      currentTime,
      { dateFormat: 'MMMM D, YYYY', timeFormat: 'HH.mm' },
    ),
    [
      'title: "Tuesday planning"',
      'day: July 28, 2026',
      'time: 14.45',
      'long: July 28, 2026',
      'file: Tue, Jul 28 2026',
      'templater: <% tp.date.now("YYYY-MM-DD") %>',
    ].join('\n'),
  );
});

test('Daily Note path identity preserves slash-containing date formats', () => {
  assert.equal(
    getDailyNotePathDateCandidate('Inbox/Daily/2026/07/28.md', 'Inbox/Daily'),
    '2026/07/28',
  );
  assert.equal(
    getDailyNotePathDateCandidate('Inbox/Other/2026/07/28.md', 'Inbox/Daily'),
    null,
  );
});

test('nested Daily Note paths remain recognizable for Home and inherited task scheduling', async () => {
  const { parseDailyNoteFileDate } = await loadDailyNoteTaskSchedule();
  const app = {
    internalPlugins: {
      getPluginById(id) {
        return id === 'daily-notes'
          ? { instance: { options: { folder: 'Inbox/Daily', format: 'YYYY/MM/DD' } } }
          : null;
      },
      plugins: {},
    },
  };

  assert.equal(
    parseDailyNoteFileDate(app, {}, {
      path: 'Inbox/Daily/2026/07/28.md',
      basename: '28',
    }),
    '2026-07-28',
  );
  assert.equal(
    parseDailyNoteFileDate(app, {}, {
      path: 'Inbox/Other/2026/07/28.md',
      basename: '28',
    }),
    null,
  );
});

test('all active GCM Daily Note creation routes use the canonical creator', () => {
  const noteOperationSource = readFileSync(new URL('../src/services/note-operation-service.ts', import.meta.url), 'utf8');
  const homeCaptureSource = readFileSync(new URL('../src/services/home-capture-service.ts', import.meta.url), 'utf8');
  const dailyNavSource = readFileSync(new URL('../src/handlers/daily-note-nav-manager.ts', import.meta.url), 'utf8');
  const timeTrackingSource = readFileSync(new URL('../src/services/time-tracking-service.ts', import.meta.url), 'utf8');
  const createTaskSource = readFileSync(new URL('../src/services/create-task-service.ts', import.meta.url), 'utf8');
  const homeViewSource = readFileSync(new URL('../src/views/home-view.ts', import.meta.url), 'utf8');

  assert.match(noteOperationSource, /pendingDailyNoteEnsures/u);
  assert.match(noteOperationSource, /getPluginById\?\.\('daily-notes'\)[\s\S]*plugins\?\.\['daily-notes'\]/u);
  assert.match(noteOperationSource, /daily-notes\.json/u);
  assert.match(noteOperationSource, /Configured Daily Notes template is unavailable; refusing to create a template-less note/u);
  assert.doesNotMatch(noteOperationSource, /createViaDailyNoteProvider/u);
  assert.match(
    noteOperationSource,
    /finishPendingTemplaterTemplate\(created, \{\s*awaitAutoCreateHook: true,\s*createStartedAt,\s*\}\)/u,
  );
  assert.match(noteOperationSource, /loadLocalStorage\?\.\('templater-local-settings'\)/u);
  assert.match(noteOperationSource, /waitForTemplaterCreateHook/u);
  assert.match(noteOperationSource, /ensureDailyNoteTitleFallback\(fm, titleValue\)/u);
  assert.doesNotMatch(noteOperationSource, /fm\.title\s*=\s*titleValue/u);

  assert.match(homeCaptureSource, /noteOperationService\.ensureDailyNote\(`\$\{isoDate\} 00:00:00`\)/u);
  assert.doesNotMatch(
    homeCaptureSource.match(/private async ensureDailyNote\(date: any\): Promise<TFile> \{([\s\S]*?)\n  \}/u)?.[1] ?? '',
    /vault\.create/u,
  );
  assert.match(dailyNavSource, /return this\.plugin\.noteOperationService\.ensureDailyNote\(`\$\{isoDate\} 00:00:00`\)/u);
  assert.doesNotMatch(dailyNavSource, /fm\.title\s*=\s*titleValue/u);
  assert.match(timeTrackingSource, /private async ensureDailyNoteForDate\(date: Date\): Promise<TFile>/u);
  assert.match(timeTrackingSource, /noteOperationService\.ensureDailyNote\(`\$\{isoDate\} 00:00:00`\)/u);
  assert.match(createTaskSource, /openCreateTaskModalWithCanonicalTarget/u);
  assert.doesNotMatch(createTaskSource, /getTodayDailyNoteIfExists/u);
  assert.match(homeViewSource, /quick-capture:daily-note-unavailable/u);
  assert.match(homeViewSource, /base:daily-note-unavailable/u);
});

test('Daily Note kind identity receives the title and filename sync exception', () => {
  const fileNamingSource = readFileSync(new URL('../src/services/file-naming-service.ts', import.meta.url), 'utf8');
  const noteOperationSource = readFileSync(new URL('../src/services/note-operation-service.ts', import.meta.url), 'utf8');
  const bulkEditSource = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');

  assert.match(fileNamingSource, /const kinds = this\.normalizeFrontmatterStringList\(\(frontmatter as any\)\.kind \|\| \(frontmatter as any\)\.kinds\)/u);
  assert.match(fileNamingSource, /value === 'dailynote'/u);
  assert.match(fileNamingSource, /isConfiguredDailyNotePath\(liveFile\)/u);
  assert.match(fileNamingSource, /loadPersistedDailyNoteConfiguration/u);
  assert.match(fileNamingSource, /await this\.dailyNoteConfigurationReady/u);
  assert.match(fileNamingSource, /getPeriodicDailyNoteOptions/u);
  assert.match(fileNamingSource, /knownDailyNoteConfigurations/u);
  assert.match(noteOperationSource, /registerDailyNoteConfiguration\(settings\.folder, settings\.format\)/u);
  assert.match(fileNamingSource, /preserveDailyNoteIdentity/u);
  assert.match(bulkEditSource, /const kind = this\.normalizeStringList\(\(frontmatter as any\)\.kind \|\| \(frontmatter as any\)\.kinds\)/u);
  assert.match(settingsSource, /Daily Notes keep their template or user title and retain the canonical Daily Notes filename\./u);
});

test('canonical GCM creation inserts the template once and preserves its readable title', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      const slash = path.lastIndexOf('/');
      this.parent = { path: slash >= 0 ? path.slice(0, slash) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templaterAutoTrigger: true,
  });
  const service = new NoteOperationService(harness.plugin);

  const [first, second] = await Promise.all([
    service.ensureDailyNote('2026-07-28 00:00:00'),
    service.ensureDailyNote('2026-07-28 00:00:00'),
  ]);

  assert.equal(first.path, 'Daily/2026-07-28.md');
  assert.equal(second.path, first.path);
  assert.equal(harness.stats.createCount, 1);
  assert.equal(harness.stats.templaterRuns, 1);
  assert.equal(harness.stats.templaterAutoRuns, 1);
  assert.equal(harness.stats.templaterExplicitRuns, 0);
  const content = harness.files.get(first.path);
  assert.match(content, /title: "Tuesday planning"/);
  assert.match(content, /kind: "dailynote"/);
  assert.match(content, /# Template section/);
  assert.match(content, /Templater body/);
  assert.doesNotMatch(content, /title: "2026-07-28"/);

  const reuseStartedAt = Date.now();
  await service.ensureDailyNote('2026-07-28 00:00:00');
  assert.ok(
    Date.now() - reuseStartedAt < 300,
    'an existing Daily Note should not inherit the auto-create settlement delay',
  );
  assert.equal(harness.stats.templaterRuns, 1, 'reusing an existing Daily Note must not rerun Templater');
  assert.match(harness.files.get(first.path), /title: "Tuesday planning"/);
  assert.equal(harness.stats.nativeProcessFrontMatterCalls, 0, 'daily-note normalization must stay on the owned mutation service');
});

test('Templater local auto-create processing settles before a later capture mutation', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templaterAutoTrigger: false,
    templaterLocalAutoTrigger: true,
    templaterAutoHookDelayMs: 20,
    templaterAutoHookWriteDelayMs: 120,
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-07-31 00:00:00');

  assert.ok(file, 'Daily Note creation should wait for Templater instead of failing');
  assert.equal(harness.stats.templaterRuns, 1);
  assert.equal(harness.stats.templaterAutoRuns, 1);
  assert.equal(harness.stats.templaterExplicitRuns, 0);

  // If ensureDailyNote returned before the delayed hook wrote its earlier
  // snapshot, this capture would be overwritten when that hook completed.
  await new Promise((resolve) => setTimeout(resolve, 45));
  await harness.plugin.app.vault.modify(
    file,
    `${harness.files.get(file.path)}\n- captured after Daily Note creation\n`,
  );
  await harness.waitForAutoHooks();

  assert.match(harness.files.get(file.path), /Templater body/);
  assert.match(harness.files.get(file.path), /captured after Daily Note creation/);
});

test('Templater auto-create settlement protects captures when the template has no commands', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templateContent: [
      '---',
      'title: "{{date:dddd}} planning"',
      'kind: dailynote',
      'scheduled: "{{date}} 00:00:00"',
      '---',
      '',
      '# Plain template section',
      '',
    ].join('\n'),
    templaterLocalAutoTrigger: true,
    templaterAutoHookDelayMs: 20,
    templaterAutoHookWriteDelayMs: 120,
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-08-02 00:00:00');

  assert.ok(file);
  assert.equal(harness.stats.templaterRuns, 1);
  assert.equal(harness.stats.templaterAutoRuns, 1);
  assert.equal(harness.stats.templaterExplicitRuns, 0);

  await new Promise((resolve) => setTimeout(resolve, 45));
  await harness.plugin.app.vault.modify(
    file,
    `${harness.files.get(file.path)}\n- capture after plain-template creation\n`,
  );
  await harness.waitForAutoHooks();

  assert.match(harness.files.get(file.path), /Plain template section/);
  assert.match(harness.files.get(file.path), /capture after plain-template creation/);
});

test('Templater auto-create settlement also protects a new template-less Daily Note', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templateContent: null,
    runtimeDailyNotes: {
      folder: 'Daily',
      format: 'YYYY-MM-DD',
      template: '',
    },
    templaterLocalAutoTrigger: true,
    templaterAutoHookDelayMs: 20,
    templaterAutoHookWriteDelayMs: 120,
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-08-04 00:00:00');

  assert.ok(file);
  assert.equal(harness.stats.templaterRuns, 1);
  assert.equal(harness.stats.templaterExplicitRuns, 0);
  await harness.plugin.app.vault.modify(
    file,
    `${harness.files.get(file.path)}\n- capture after template-less creation\n`,
  );
  await harness.waitForAutoHooks();

  assert.match(harness.files.get(file.path), /tags: "\[dailynote\]"/);
  assert.match(harness.files.get(file.path), /capture after template-less creation/);
});

test('an already-exists creation race still waits for the competing Templater hook', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templaterLocalAutoTrigger: true,
    simulateCreateRace: true,
    templaterAutoHookDelayMs: 20,
    templaterAutoHookWriteDelayMs: 120,
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-08-03 00:00:00');

  assert.ok(file);
  assert.equal(harness.stats.createCount, 1);
  assert.equal(harness.stats.templaterRuns, 1);
  assert.equal(harness.stats.templaterAutoRuns, 1);
  assert.equal(harness.stats.templaterExplicitRuns, 0);
  assert.match(harness.files.get(file.path), /Templater body/);
});

test('a freshly observed exact-existing Daily Note waits for its external Templater hook', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templaterLocalAutoTrigger: true,
    templaterAutoHookDelayMs: 20,
    templaterAutoHookWriteDelayMs: 120,
  });
  const external = harness.seedExternalCreation('Daily/2026-08-05.md', [
    '---',
    'Title: "External readable Daily Note"',
    'kind: dailynote',
    '---',
    '',
    '<% daily-body %>',
    '',
  ].join('\n'));
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-08-05 00:00:00');

  assert.equal(file.path, external.path);
  assert.equal(harness.stats.createCount, 0);
  assert.equal(harness.stats.templaterRuns, 1);
  await harness.plugin.app.vault.modify(
    file,
    `${harness.files.get(file.path)}\n- capture after external creation\n`,
  );
  await harness.waitForAutoHooks();

  assert.match(harness.files.get(file.path), /Title: "External readable Daily Note"/);
  assert.match(harness.files.get(file.path), /Templater body/);
  assert.match(harness.files.get(file.path), /capture after external creation/);
});

test('a disabled Templater local auto-create setting performs exactly one explicit pass', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templaterAutoTrigger: true,
    templaterLocalAutoTrigger: false,
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-08-01 00:00:00');

  assert.ok(file);
  assert.equal(harness.stats.templaterRuns, 1);
  assert.equal(harness.stats.templaterAutoRuns, 0);
  assert.equal(harness.stats.templaterExplicitRuns, 1);
  assert.match(harness.files.get(file.path), /Templater body/);
});

test('canonical GCM creation fails closed when a configured template is missing', async () => {
  installDailyNoteMoment();
  globalThis.__dailyNoteNotices = [];
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = 'md';
      this.basename = path.split('/').pop().replace(/\.md$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templatePath: 'Templates/Missing Daily',
    templateContent: null,
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-07-29 00:00:00');

  assert.equal(file, null);
  assert.equal(harness.stats.createCount, 0);
  assert.equal(harness.files.has('Daily/2026-07-29.md'), false);
  assert.match(globalThis.__dailyNoteNotices.at(-1), /Daily Notes template not found/);
});

test('canonical GCM creation falls back to persisted Daily Notes settings before creating', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes: null,
    persistedDailyNotes: {
      folder: 'Persisted/Daily',
      format: 'YYYY-MM-DD',
      template: 'Templates/Daily',
    },
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-07-30 00:00:00');

  assert.equal(file.path, 'Persisted/Daily/2026-07-30.md');
  assert.match(harness.files.get(file.path), /title: "Thursday planning"/);
  assert.match(harness.files.get(file.path), /Templater body/);
  assert.equal(harness.stats.templaterRuns, 1);
});

test('a disabled Core Daily Notes wrapper cannot mask configured Periodic Notes', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes: {
      folder: 'Disabled/Core',
      format: 'YYYY-MM-DD',
      template: '',
    },
    runtimeDailyNotesEnabled: false,
    periodicDailyNotes: {
      folder: 'Periodic/Daily',
      format: 'YYYY_MM_DD',
      template: 'Templates/Daily',
    },
    persistedDailyNotes: {
      folder: 'Stale/Core',
      format: 'YYYY-MM-DD',
      template: '',
    },
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-07-30 00:00:00');

  assert.equal(file.path, 'Periodic/Daily/2026_07_30.md');
  assert.match(harness.files.get(file.path), /Thursday planning/);
  assert.match(harness.files.get(file.path), /Templater body/);
  assert.equal(harness.stats.templaterRuns, 1);
});

test('partial runtime Daily Notes settings merge the persisted template and avoid the provider path', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes: {
      folder: 'Runtime/Daily',
      format: 'YYYY-MM-DD',
    },
    persistedDailyNotes: {
      folder: 'Stale/Persisted',
      format: 'YYYY_MM_DD',
      template: 'Templates/Daily',
    },
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-07-28 00:00:00');

  assert.equal(file.path, 'Runtime/Daily/2026-07-28.md');
  assert.match(harness.files.get(file.path), /Tuesday planning/);
  assert.match(harness.files.get(file.path), /Templater body/);
  assert.equal(harness.stats.templaterRuns, 1);
});

test('a transient blank runtime template cannot mask the saved Daily Notes template', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes: {
      folder: 'Runtime/Daily',
      format: 'YYYY-MM-DD',
      template: '',
    },
    persistedDailyNotes: {
      template: 'Templates/Daily',
    },
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-07-29 00:00:00');

  assert.equal(file.path, 'Runtime/Daily/2026-07-29.md');
  assert.match(harness.files.get(file.path), /Template section/);
  assert.match(harness.files.get(file.path), /Templater body/);
  assert.equal(harness.stats.templaterRuns, 1);
});

test('a durably blank Daily Notes template remains template-less', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes: {
      folder: 'Runtime/Daily',
      format: 'YYYY-MM-DD',
      template: '',
    },
    persistedDailyNotes: {
      template: '',
    },
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-07-29 00:00:00');

  assert.equal(file.path, 'Runtime/Daily/2026-07-29.md');
  assert.doesNotMatch(harness.files.get(file.path), /Template section/);
  assert.equal(harness.stats.templaterRuns, 0);
});

test('a configured runtime template wins over a different saved template', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes: {
      folder: 'Runtime/Daily',
      format: 'YYYY-MM-DD',
      template: 'Templates/Daily',
    },
    persistedDailyNotes: {
      template: 'Templates/Old Daily',
    },
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-07-29 00:00:00');

  assert.equal(file.path, 'Runtime/Daily/2026-07-29.md');
  assert.match(harness.files.get(file.path), /Template section/);
  assert.equal(harness.stats.templaterRuns, 1);
});

test('an unavailable saved Daily Notes file leaves a blank runtime template blank', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes: {
      folder: 'Runtime/Daily',
      format: 'YYYY-MM-DD',
      template: '',
    },
    persistedDailyNotes: null,
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-07-29 00:00:00');

  assert.equal(file.path, 'Runtime/Daily/2026-07-29.md');
  assert.doesNotMatch(harness.files.get(file.path), /Template section/);
  assert.equal(harness.stats.templaterRuns, 0);
});

test('canonical GCM creation creates every parent introduced by a nested date format', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes: {
      folder: 'Inbox/Daily',
      format: 'YYYY/MM/DD',
      template: 'Templates/Daily',
    },
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-07-30 00:00:00');

  assert.equal(file.path, 'Inbox/Daily/2026/07/30.md');
  assert.match(harness.files.get(file.path), /Thursday planning/);
  assert.equal(harness.stats.createCount, 1);
});
