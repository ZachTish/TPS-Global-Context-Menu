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
            export class TFolder {
              constructor(path = '') {
                this.path = path;
                this.name = String(path).split('/').pop() || '';
                this.children = [];
              }
            }
            export class Notice {}
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
            export function parseYaml() { return {}; }
            export function stringifyYaml(value) { return JSON.stringify(value); }
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadFileNamingService() {
  const result = await build({
    stdin: {
      contents: [
        "export * from './src/services/file-naming-service.ts';",
        "export { findExistingDailyNoteForIsoDate, getDailyNotePathForIsoDate, parseDailyNoteFileDate } from './src/utils/daily-note-task-schedule.ts';",
      ].join('\n'),
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      sourcefile: 'file-naming-test-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'file-naming-obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian-stub', namespace: 'obsidian-stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'obsidian-stub' }, () => ({
          loader: 'js',
          contents: `
            export class TFile {
              constructor(path) {
                this.__isTestTFile = true;
                this.path = path;
                this.name = path.split('/').pop() || path;
                this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
                this.basename = this.name.replace(/\\.[^.]+$/, '');
              }
              static [Symbol.hasInstance](value) {
                return Boolean(value && value.__isTestTFile === true);
              }
            }
            export class TFolder {}
            export class Notice {}
            export class Menu {}
            const momentFactory = (value, format) => globalThis.window?.moment?.(value, format)
              || { isValid: () => false, format: () => String(value || '') };
            momentFactory.ISO_8601 = Symbol('ISO_8601');
            momentFactory.invalid = () => ({ isValid: () => false, format: () => '' });
            export const moment = momentFactory;
            export function normalizePath(path) {
              return String(path || '').replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/').replace(/^\\//, '');
            }
            export function parseYaml() { return {}; }
            export function stringifyYaml(value) { return JSON.stringify(value); }
          `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function loadNoteOperationService() {
  const result = await build({
    stdin: {
      contents: [
        "export * from './src/services/note-operation-service.ts';",
        "export { invalidateDailyNoteCandidateIndex, markDailyNoteCandidatePathDirty } from './src/utils/daily-note-task-schedule.ts';",
      ].join('\n'),
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      sourcefile: 'daily-note-creation-test-entry.ts',
      loader: 'ts',
    },
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
            export class TFolder {
              constructor(path = '') {
                this.path = path;
                this.name = String(path).split('/').pop() || '';
                this.children = [];
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
            export function parseYaml(source) {
              const normalized = String(source || '').trim();
              if (/^(?:null|~)$/iu.test(normalized)) return null;
              if (/^-\\s+/u.test(normalized)) return [{}];
              if (normalized && !normalized.split(/\\r?\\n/u).some((line) => /^([^:#]+):\\s*(.*)$/u.test(line))) {
                return normalized;
              }
              const parsed = {};
              for (const line of normalized.split(/\\r?\\n/)) {
                const match = line.match(/^([^:#]+):\\s*(.*)$/);
                if (!match) continue;
                let value = match[2].trim();
                if (/^(['"]).*\\1$/.test(value)) value = value.slice(1, -1);
                parsed[match[1].trim()] = value;
              }
              return parsed;
            }
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
  templaterTransform = null,
  createDelayMs = 0,
  templaterAvailable = true,
  simulateCreateRace = false,
  simulateCreateRaceContent = null,
  vaultProcessAvailable = true,
  vaultProcessError = null,
  metadataFrontmatterOverride = null,
  afterOwnedFrontmatterProcess,
  beforeRead,
  beforeProcess,
  beforeAdapterExists,
} = {}) {
  const files = new Map();
  const fileObjects = new Map();
  const fileTimes = new Map();
  const folders = new Set(['']);
  const vaultListeners = new Map();
  const emitVault = (event, ...args) => {
    for (const callback of vaultListeners.get(event) || []) callback(...args);
  };
  const templaterPendingFiles = new Set();
  const autoHookPromises = [];
  let createCount = 0;
  let templaterRuns = 0;
  let templaterAutoRuns = 0;
  let templaterExplicitRuns = 0;
  let registeredDailyNoteConfiguration = null;
  if (templateContent !== null) {
    files.set('Templates/Daily.md', templateContent);
    fileTimes.set('Templates/Daily.md', Date.now() - 10_000);
  }
  const effectiveTemplaterAutoTrigger = typeof templaterLocalAutoTrigger === 'boolean'
    ? templaterLocalAutoTrigger
    : templaterAutoTrigger;
  const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const applyTemplaterCommands = (content) => typeof templaterTransform === 'function'
    ? templaterTransform(String(content || ''))
    : String(content || '').replace('<% daily-body %>', 'Templater body');
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
    let file = fileObjects.get(path);
    if (!file) {
      file = new TFile(path);
      fileObjects.set(path, file);
    }
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
        if (id === 'daily-notes' && registeredDailyNoteConfiguration) {
          return {
            enabled: true,
            instance: { options: registeredDailyNoteConfiguration },
          };
        }
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
        'templater-obsidian': templaterAvailable ? {
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
        } : null,
      },
    },
    metadataCache: {
      getFirstLinkpathDest: () => null,
      getFileCache(file) {
        if (metadataFrontmatterOverride !== null) {
          const override = typeof metadataFrontmatterOverride === 'function'
            ? metadataFrontmatterOverride(file)
            : metadataFrontmatterOverride;
          if (override !== undefined && override !== null) return { frontmatter: override };
        }
        return { frontmatter: parseFrontmatter(files.get(file.path) || '').frontmatter };
      },
    },
    vault: {
      configDir: '.obsidian',
      adapter: {
        async exists(path) {
          await beforeAdapterExists?.({ app, path, files, fileTimes, emitVault, fileFor });
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
      on(event, callback) {
        const callbacks = vaultListeners.get(event) || [];
        callbacks.push(callback);
        vaultListeners.set(event, callbacks);
      },
      async read(file) {
        await beforeRead?.({ app, file, files, fileTimes, emitVault });
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
        if (createDelayMs > 0) await delay(createDelayMs);
        else await Promise.resolve();
        if (files.has(path)) throw new Error(`File already exists: ${path}`);
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        if (parent && !folders.has(parent)) throw new Error(`Missing parent folder: ${parent}`);
        createCount += 1;
        files.set(path, content);
        fileTimes.set(path, Date.now());
        emitVault('create', fileFor(path));
        scheduleTemplaterAutoHook(path);
        if (simulateCreateRace) {
          if (simulateCreateRaceContent !== null) files.set(path, simulateCreateRaceContent);
          throw new Error(`File already exists: ${path}`);
        }
        return fileFor(path);
      },
      async modify(file, content) {
        files.set(file.path, content);
        emitVault('modify', file);
      },
      async process(file, processor) {
        await beforeProcess?.({ app, file, files, fileTimes, emitVault });
        const current = files.get(file.path);
        const next = processor(current);
        files.set(file.path, next);
        emitVault('modify', file);
        return next;
      },
    },
    fileManager: {
      async renameFile(file, targetPath) {
        const sourcePath = file.path;
        if (!files.has(sourcePath) || files.has(targetPath)) {
          throw new Error(`Cannot rename ${sourcePath} to ${targetPath}`);
        }
        const content = files.get(sourcePath);
        const timestamp = fileTimes.get(sourcePath);
        files.delete(sourcePath);
        fileTimes.delete(sourcePath);
        fileObjects.delete(sourcePath);
        files.set(targetPath, content);
        if (timestamp !== undefined) fileTimes.set(targetPath, timestamp);
        file.path = targetPath;
        file.extension = targetPath.split('.').pop();
        file.basename = targetPath.split('/').pop().replace(/\.[^.]+$/, '');
        file.parent = { path: targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '/' };
        fileObjects.set(targetPath, file);
        emitVault('rename', file, sourcePath);
      },
      async processFrontMatter(file, mutator) {
        const parsed = parseFrontmatter(files.get(file.path) || '');
        mutator(parsed.frontmatter);
        files.set(file.path, writeFrontmatter(parsed.frontmatter, parsed.body));
      },
    },
  };
  if (!vaultProcessAvailable) {
    delete app.vault.process;
  } else if (vaultProcessError) {
    app.vault.process = async () => {
      throw vaultProcessError;
    };
  }
  let nativeProcessFrontMatterCalls = 0;
  const processOwnedFrontmatter = async (file, mutator) => {
    const parsed = parseFrontmatter(files.get(file.path) || '');
    await mutator(parsed.frontmatter);
    files.set(file.path, writeFrontmatter(parsed.frontmatter, parsed.body));
    await afterOwnedFrontmatterProcess?.({ app, file, files, fileTimes, emitVault });
    return true;
  };
  app.fileManager.processFrontMatter = async () => {
    nativeProcessFrontMatterCalls += 1;
    throw new Error('Daily-note creation bypassed the owned frontmatter mutation service.');
  };
  const getDailyNoteConfigurationSnapshot = () => {
    const core = runtimeDailyNotes !== null && runtimeDailyNotesEnabled
      ? runtimeDailyNotes
      : null;
    const persistedTemplate = String(persistedDailyNotes?.template || '').trim();
    if (core && !String(core.template || '').trim() && persistedTemplate) {
      return {
        folder: String(persistedDailyNotes?.folder || '').replace(/^\/+|\/+$/g, ''),
        format: String(persistedDailyNotes?.format || '').trim() || 'YYYY-MM-DD',
        template: persistedTemplate,
        source: 'persisted-recovery',
      };
    }
    if (core) {
      return {
        folder: String(core.folder || '').replace(/^\/+|\/+$/g, ''),
        format: String(core.format || '').trim() || 'YYYY-MM-DD',
        template: String(core.template || '').trim(),
        source: 'core',
      };
    }
    if (periodicDailyNotes) {
      return {
        folder: String(periodicDailyNotes.folder || '').replace(/^\/+|\/+$/g, ''),
        format: String(periodicDailyNotes.format || '').trim() || 'YYYY-MM-DD',
        template: String(periodicDailyNotes.template || '').trim(),
        source: 'periodic',
      };
    }
    if (persistedDailyNotes) {
      return {
        folder: String(persistedDailyNotes.folder || '').replace(/^\/+|\/+$/g, ''),
        format: String(persistedDailyNotes.format || '').trim() || 'YYYY-MM-DD',
        template: persistedTemplate,
        source: 'persisted',
      };
    }
    return { folder: 'System/Dailynotes', format: 'YYYY-MM-DD', template: '', source: 'default' };
  };
  const plugin = {
    app,
    settings: { autoSaveFolderPath: false },
    frontmatterMutationService: {
      process: processOwnedFrontmatter,
    },
    fileNamingService: {
      registerDailyNoteConfiguration(folder, format) {
        registeredDailyNoteConfiguration = { folder, format, template: '' };
      },
      isDailyNoteConfigurationReady() { return true; },
      async whenDailyNoteConfigurationReady() {},
      getDailyNoteConfigurationSnapshot,
      async processFileOnOpen() {},
    },
    notebookNavigatorRuleService: { async applyRulesToFile() {} },
  };
  return {
    plugin,
    files,
    seedExisting(path, content, ageMs = 10_000) {
      files.set(path, content);
      fileTimes.set(path, Date.now() - Math.max(0, ageMs));
      emitVault('create', fileFor(path));
      return fileFor(path);
    },
    seedExternalCreation(path, content) {
      files.set(path, content);
      fileTimes.set(path, Date.now());
      emitVault('create', fileFor(path));
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
  const fileNamingSource = readFileSync(new URL('../src/services/file-naming-service.ts', import.meta.url), 'utf8');

  assert.match(noteOperationSource, /pendingDailyNoteEnsures/u);
  assert.match(noteOperationSource, /getDailyNoteConfigurationSnapshot\?\.\(\)/u);
  assert.match(fileNamingSource, /daily-notes\.json/u);
  assert.match(noteOperationSource, /Configured Daily Notes template is unavailable; refusing to create a template-less note/u);
  assert.doesNotMatch(noteOperationSource, /createViaDailyNoteProvider/u);
  assert.match(
    noteOperationSource,
    /finishPendingTemplaterTemplate\(created, \{\s*awaitAutoCreateHook: true,\s*createStartedAt: templaterCreateObservedAt,\s*preparedInput:/u,
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
  const dailyNoteScheduleSource = readFileSync(new URL('../src/utils/daily-note-task-schedule.ts', import.meta.url), 'utf8');
  const noteOperationSource = readFileSync(new URL('../src/services/note-operation-service.ts', import.meta.url), 'utf8');
  const bulkEditSource = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');

  assert.match(fileNamingSource, /return parseDailyNoteFileDate\(this\.plugin\.app, this\.plugin\.settings, file\) !== null/u);
  assert.match(dailyNoteScheduleSource, /isAcceptedDailyNoteMarker\(normalizeDailyNoteMarker\(value\)\)/u);
  assert.match(
    dailyNoteScheduleSource,
    /marker === 'daily'[\s\S]{0,120}marker === 'dailynote'[\s\S]{0,120}marker === 'notedaily'/u,
  );
  assert.match(fileNamingSource, /if \(await this\.isDailyNoteFile\(liveFile\)\) return/u);
  assert.match(fileNamingSource, /loadPersistedDailyNoteConfiguration/u);
  assert.match(fileNamingSource, /await this\.dailyNoteConfigurationReady/u);
  assert.match(fileNamingSource, /getPeriodicDailyNoteOptions/u);
  assert.match(fileNamingSource, /public async isDailyNoteFile\(file: TFile\): Promise<boolean>/u);
  assert.match(fileNamingSource, /knownDailyNoteConfigurations/u);
  assert.match(noteOperationSource, /registerDailyNoteConfiguration\(settings\.folder, settings\.format\)/u);
  assert.match(fileNamingSource, /preserveDailyNoteIdentity/u);
  assert.match(bulkEditSource, /return this\.plugin\.fileNamingService\.isDailyNoteFile\(file\)/u);
  assert.match(settingsSource, /Daily Notes keep their template or user title and retain the canonical Daily Notes filename\./u);
});

test('Daily Note move classification awaits persisted settings and honors Periodic Notes when Core is disabled', async () => {
  const priorWindow = globalThis.window;
  globalThis.window = {
    moment(value, format) {
      const text = String(value || '');
      const patterns = {
        'YYYY-MM-DD': /^\d{4}-\d{2}-\d{2}$/u,
        'YYYY_MM_DD': /^\d{4}_\d{2}_\d{2}$/u,
        'YYYY/MM/DD': /^\d{4}\/\d{2}\/\d{2}$/u,
      };
      const formats = Array.isArray(format) ? format : [format];
      const valid = formats.some((candidate) => Boolean(patterns[String(candidate || '')]?.test(text)));
      const iso = text.replace(/_/g, '-').replace(/\//g, '-');
      return { isValid: () => valid, format: (target) => target === 'YYYY-MM-DD' ? iso : text };
    },
  };
  try {
    const { FileNamingService, getDailyNotePathForIsoDate } = await loadFileNamingService();
    const createPlugin = ({ persisted, periodic, core = null, beforePersistedRead }) => ({
      settings: { dailyNoteDateFormat: '' },
      app: {
        internalPlugins: {
          plugins: {
            'daily-notes': {
              enabled: core !== null,
              instance: { options: core ?? { folder: 'Disabled/Core', format: 'YYYY-MM-DD' } },
            },
          },
        },
        plugins: {
          getPlugin(id) {
            return id === 'periodic-notes' && periodic
              ? { settings: { daily: periodic } }
              : null;
          },
          plugins: {},
        },
        vault: {
          configDir: '.obsidian',
          getFiles: () => [],
          adapter: {
            async read() {
              await beforePersistedRead?.();
              if (persisted == null) throw new Error('missing settings');
              return JSON.stringify(persisted);
            },
          },
        },
        metadataCache: {
          getFileCache(file) {
            return { frontmatter: file.frontmatter || {} };
          },
        },
      },
    });
    const testFile = (path, frontmatter) => ({
      path,
      basename: path.split('/').pop().replace(/\.md$/u, ''),
      ...(frontmatter ? { frontmatter } : {}),
    });

    const periodicService = new FileNamingService(createPlugin({
      persisted: { folder: 'Stale/Core', format: 'YYYY-MM-DD' },
      periodic: { folder: 'Periodic/Daily', format: 'YYYY_MM_DD' },
    }));
    assert.equal(periodicService.isDailyNoteConfigurationReady(), false);
    assert.equal(await periodicService.isDailyNoteFile(testFile('Periodic/Daily/2026_08_10.md')), true);
    assert.equal(periodicService.isDailyNoteConfigurationReady(), true);
    assert.deepEqual(periodicService.getDailyNoteConfigurationSnapshot(), {
      folder: 'Periodic/Daily',
      format: 'YYYY_MM_DD',
      template: '',
      source: 'periodic',
    });
    assert.equal(await periodicService.isDailyNoteFile(testFile('Disabled/Core/2026-08-10.md')), false);
    assert.equal(await periodicService.isDailyNoteFile(testFile('Projects/2026_08_10.md')), false);

    const persistedService = new FileNamingService(createPlugin({
      persisted: { folder: 'Saved/Daily', format: 'YYYY/MM/DD' },
      periodic: null,
    }));
    assert.equal(await persistedService.isDailyNoteFile(testFile('Saved/Daily/2026/08/10.md')), true);
    assert.equal(persistedService.getDailyNoteConfigurationSnapshot()?.source, 'persisted');

    const coreService = new FileNamingService(createPlugin({
      persisted: null,
      periodic: null,
      core: { folder: 'Journal', format: 'YYYY-MM-DD', template: '' },
    }));
    assert.equal(await coreService.isDailyNoteFile(testFile('2026-08-10.md')), false);
    assert.equal(await coreService.isDailyNoteFile(testFile('Journal/2026-08-10.md')), true);
    assert.equal(await coreService.isDailyNoteFile(
      testFile('Journal/2026-08-11.md', { kind: 'calendar-event' }),
    ), false);

    const recoveringCore = { folder: '', format: '', template: '' };
    const recoveringService = new FileNamingService(createPlugin({
      persisted: { folder: 'Saved/Journal', format: 'YYYY_MM_DD', template: 'Templates/Daily' },
      periodic: null,
      core: recoveringCore,
    }));
    assert.equal(await recoveringService.isDailyNoteFile(testFile('Saved/Journal/2026_08_12.md')), true);
    assert.equal(recoveringService.getDailyNoteConfigurationSnapshot()?.source, 'persisted-recovery');
    recoveringCore.folder = 'Settled/Journal';
    recoveringCore.format = 'YYYY-MM-DD';
    recoveringCore.template = 'Templates/Daily';
    assert.equal(await recoveringService.isDailyNoteFile(testFile('Saved/Journal/2026_08_12.md')), false);
    assert.equal(await recoveringService.isDailyNoteFile(testFile('Settled/Journal/2026-08-12.md')), true);
    assert.deepEqual(recoveringService.getDailyNoteConfigurationSnapshot(), {
      folder: 'Settled/Journal',
      format: 'YYYY-MM-DD',
      template: 'Templates/Daily',
      source: 'core',
    });
    recoveringCore.template = '';
    assert.deepEqual(recoveringService.getDailyNoteConfigurationSnapshot(), {
      folder: 'Settled/Journal',
      format: 'YYYY-MM-DD',
      template: '',
      source: 'core',
    }, 'a later intentional blank Core template must not revive the startup snapshot');

    const templateLessStartupCore = { folder: '', format: 'YYYY-MM-DD', template: '' };
    const templateLessStartupService = new FileNamingService(createPlugin({
      persisted: { folder: 'Inbox/Daily', format: 'YYYY-MM-DD' },
      periodic: null,
      core: templateLessStartupCore,
    }));
    await templateLessStartupService.whenDailyNoteConfigurationReady();
    assert.deepEqual(templateLessStartupService.getDailyNoteConfigurationSnapshot(), {
      folder: 'Inbox/Daily',
      format: 'YYYY-MM-DD',
      template: '',
      source: 'persisted-recovery',
    });
    assert.equal(
      getDailyNotePathForIsoDate(templateLessStartupService.plugin.app, templateLessStartupService.plugin.settings, '2026-08-25'),
      'Inbox/Daily/2026-08-25.md',
      'template-less startup recovery must publish the persisted canonical path instead of Core\'s temporary root path',
    );
    assert.equal(await templateLessStartupService.isDailyNoteFile(testFile('Inbox/Daily/2026-08-25.md')), true);
    assert.equal(await templateLessStartupService.isDailyNoteFile(testFile('2026-08-25.md')), false);
    templateLessStartupCore.folder = 'Inbox/Daily';
    assert.deepEqual(templateLessStartupService.getDailyNoteConfigurationSnapshot(), {
      folder: 'Inbox/Daily',
      format: 'YYYY-MM-DD',
      template: '',
      source: 'core',
    });

    let releasePersistedRead;
    const persistedReadGate = new Promise((resolve) => { releasePersistedRead = resolve; });
    const racingCore = { folder: '', format: '', template: '' };
    const racingService = new FileNamingService(createPlugin({
      persisted: { folder: 'Saved/Race', format: 'YYYY_MM_DD', template: 'Templates/Daily' },
      periodic: null,
      core: racingCore,
      beforePersistedRead: () => persistedReadGate,
    }));
    racingCore.folder = 'Live/Race';
    racingCore.format = 'YYYY-MM-DD';
    racingCore.template = '';
    releasePersistedRead();
    await racingService.whenDailyNoteConfigurationReady();
    assert.deepEqual(racingService.getDailyNoteConfigurationSnapshot(), {
      folder: 'Live/Race',
      format: 'YYYY-MM-DD',
      template: '',
      source: 'core',
    }, 'a Core change during persisted I/O must win as the live snapshot');
  } finally {
    globalThis.window = priorWindow;
  }
});

test('metadata refresh blocks only sync identity reads while the ready configuration stays stable', async () => {
  const priorWindow = globalThis.window;
  globalThis.window = {
    moment: (value) => {
      const text = String(value || '').slice(0, 10);
      const valid = /^\d{4}-\d{2}-\d{2}$/u.test(text);
      return { isValid: () => valid, format: () => valid ? text : '' };
    },
  };
  try {
    const {
      FileNamingService,
      findExistingDailyNoteForIsoDate,
      parseDailyNoteFileDate,
    } = await loadFileNamingService();
    const vaultEvents = new Map();
    const metadataEvents = new Map();
    const registered = [];
    let apiReadyNotifications = 0;
    let markdownMetadataReady = false;
    let overlapReadScenario = null;
    let overlapReadCount = 0;
    let olderReadStarted;
    let releaseOlderRead;
    let olderReadGate;
    let signalOlderReadStarted;
    const configureOverlapRead = (scenario) => {
      overlapReadScenario = scenario;
      overlapReadCount = 0;
      olderReadStarted = new Promise((resolve) => { signalOlderReadStarted = resolve; });
      olderReadGate = new Promise((resolve) => { releaseOlderRead = resolve; });
    };
    const markdownFile = {
      __isTestTFile: true,
      path: 'Journal/2026-08-25.md',
      basename: '2026-08-25',
      extension: 'md',
      stat: { size: 96 },
    };
    const emptyMarkdownFile = {
      __isTestTFile: true,
      path: 'Journal/2026-08-26.md',
      basename: '2026-08-26',
      extension: 'md',
      stat: { size: 0 },
    };
    const malformedMarkdownFile = {
      __isTestTFile: true,
      path: '_archive/TPS Linter Unsafe YAML QA.md',
      basename: 'TPS Linter Unsafe YAML QA',
      extension: 'md',
      stat: { size: 24 },
    };
    const attachmentFile = {
      __isTestTFile: true,
      path: 'Diagram.png',
      basename: 'Diagram',
      extension: 'png',
    };
    const folder = { path: 'Attachments', children: [] };
    const plugin = {
      settings: { dailyNoteDateFormat: '' },
      registerEvent(ref) { registered.push(ref); },
      emitGcmApiChanged(available) {
        if (available) apiReadyNotifications += 1;
      },
      app: {
        internalPlugins: {
          getPluginById(id) {
            return id === 'daily-notes'
              ? { enabled: true, instance: { options: { folder: 'Journal', format: 'YYYY-MM-DD', template: '' } } }
              : null;
          },
          plugins: {},
        },
        plugins: { getPlugin: () => null, plugins: {} },
        vault: {
          configDir: '.obsidian',
          getFiles: () => [],
          getMarkdownFiles: () => [markdownFile, emptyMarkdownFile, malformedMarkdownFile],
          getAbstractFileByPath: (path) => {
            if (path === markdownFile.path) return markdownFile;
            if (path === emptyMarkdownFile.path) return emptyMarkdownFile;
            if (path === malformedMarkdownFile.path) return malformedMarkdownFile;
            return null;
          },
          async read(file) {
            if (file === malformedMarkdownFile) return '---\nkind: project\n';
            assert.equal(file, markdownFile);
            if (overlapReadScenario) {
              overlapReadCount += 1;
              if (overlapReadCount === 1) {
                signalOlderReadStarted();
                await olderReadGate;
                if (overlapReadScenario === 'older-fails-last') {
                  throw new Error('older background read failed after the newer refresh');
                }
              }
            }
            return '---\nkind: dailynote\nscheduled: 2026-08-25 00:00:00\n---\nLive Daily Note';
          },
          adapter: { async read() { throw new Error('missing'); } },
          on(event, callback) {
            const ref = { event, callback };
            vaultEvents.set(event, ref);
            return ref;
          },
        },
        metadataCache: {
          initialized: false,
          getFileCache: (file) => {
            if (file === emptyMarkdownFile) return null;
            if (file === malformedMarkdownFile) return { frontmatter: { kind: 'project' } };
            return markdownMetadataReady ? { frontmatter: { kind: 'project' } } : null;
          },
          on(event, callback) {
            const ref = { event, callback };
            metadataEvents.set(event, ref);
            return ref;
          },
        },
      },
    };
    const service = new FileNamingService(plugin);
    await service.whenDailyNoteConfigurationReady();
    assert.equal(service.isDailyNoteMetadataCacheReady(), false);
    assert.equal(
      service.isDailyNoteMetadataCacheReady(),
      false,
      'repeated consumer reads during cold indexing must remain blocked',
    );
    assert.equal(apiReadyNotifications, 0);
    plugin.app.metadataCache.initialized = true;
    await metadataEvents.get('resolve').callback(markdownFile);
    assert.equal(
      apiReadyNotifications,
      0,
      'one resolved file must not announce identity while another metadata lookup is still incomplete',
    );
    assert.equal(service.isDailyNoteMetadataCacheReady(), false);
    vaultEvents.get('modify').callback(malformedMarkdownFile);
    await metadataEvents.get('resolved').callback();
    assert.equal(service.isDailyNoteMetadataCacheReady(), true);
    assert.equal(
      apiReadyNotifications,
      1,
      'the all-files resolved event must reannounce the API despite empty cacheless and unrelated malformed notes',
    );
    assert.equal(
      findExistingDailyNoteForIsoDate(plugin.app, plugin.settings, '2026-08-26'),
      emptyMarkdownFile,
      'a zero-byte canonical Daily Note must remain discoverable without CachedMetadata',
    );
    markdownMetadataReady = true;
    await metadataEvents.get('resolved').callback();
    assert.equal(
      apiReadyNotifications,
      1,
      'resolved must not reannounce again without another consumer-observed blocked state',
    );

    apiReadyNotifications = 0;
    assert.equal(service.isDailyNoteMetadataCacheReady(), true);
    assert.equal(service.getDailyNoteConfigurationSnapshot()?.folder, 'Journal');

    for (const event of ['create', 'modify', 'rename']) {
      vaultEvents.get(event).callback(attachmentFile);
      assert.equal(
        service.isDailyNoteMetadataCacheReady(),
        true,
        `${event} on a non-Markdown attachment must not await impossible Markdown metadata`,
      );
      vaultEvents.get(event).callback(folder);
      assert.equal(
        service.isDailyNoteMetadataCacheReady(),
        true,
        `${event} on a folder must not await impossible Markdown metadata`,
      );
    }
    vaultEvents.get('modify').callback(markdownFile);
    assert.equal(service.isDailyNoteMetadataCacheReady(), false);
    assert.equal(service.getDailyNoteConfigurationSnapshot()?.folder, 'Journal');
    const backgroundRefresh = metadataEvents.get('changed').callback(markdownFile);
    assert.equal(
      service.isDailyNoteMetadataCacheReady(),
      false,
      'an uncorrelated metadata event must not expose sync identity before current bytes win',
    );
    await backgroundRefresh;
    assert.equal(service.isDailyNoteMetadataCacheReady(), true);
    assert.equal(await service.isDailyNoteFile(markdownFile), true);
    assert.equal(
      findExistingDailyNoteForIsoDate(plugin.app, plugin.settings, '2026-08-25'),
      markdownFile,
      'findForIsoDate identity must recover from the current-byte override',
    );
    assert.equal(
      parseDailyNoteFileDate(plugin.app, plugin.settings, markdownFile),
      '2026-08-25',
      'dateForFile and task-policy identity must recover from the current-byte override',
    );
    assert.equal(apiReadyNotifications, 1, 'provider consumers must be notified when identity becomes ready');

    configureOverlapRead('older-fails-last');
    vaultEvents.get('modify').callback(markdownFile);
    const olderRefresh = metadataEvents.get('changed').callback(markdownFile);
    await olderReadStarted;
    const newerRefresh = metadataEvents.get('changed').callback(markdownFile);
    assert.equal(
      overlapReadCount,
      1,
      'overlapping metadata callbacks must join the active background reader',
    );
    releaseOlderRead();
    await Promise.all([olderRefresh, newerRefresh]);
    assert.equal(service.isDailyNoteMetadataCacheReady(), true);
    assert.equal(
      overlapReadCount,
      2,
      'a trailing callback must replay the failed pass on the same serialized worker',
    );
    assert.equal(apiReadyNotifications, 2, 'the serialized recovery must publish readiness exactly once');

    configureOverlapRead('duplicate-joins');
    vaultEvents.get('modify').callback(markdownFile);
    const refreshOwner = metadataEvents.get('changed').callback(markdownFile);
    await olderReadStarted;
    const duplicateRefresh = metadataEvents.get('changed').callback(markdownFile);
    releaseOlderRead();
    await Promise.all([refreshOwner, duplicateRefresh]);
    assert.equal(
      service.isDailyNoteMetadataCacheReady(),
      true,
      'a duplicate callback must share the successful owner without leaving readiness blocked',
    );
    assert.equal(overlapReadCount, 1, 'a duplicate callback with no newer dirty generation must not reread bytes');
    assert.equal(apiReadyNotifications, 3, 'the shared successful generation must publish readiness exactly once');
    assert.ok(registered.length >= 8, 'all vault/metadata listeners must be lifecycle-owned');

    markdownMetadataReady = false;
    const hotReloadedService = new FileNamingService(plugin);
    await hotReloadedService.whenDailyNoteConfigurationReady();
    assert.equal(
      hotReloadedService.isDailyNoteMetadataCacheReady(),
      true,
      'a hot reload after MetadataCache initialization must not wait for an already-fired resolved event',
    );
    plugin.app.metadataCache.initialized = false;
    assert.equal(hotReloadedService.isDailyNoteMetadataCacheReady(), false);
    plugin.app.metadataCache.initialized = true;
    assert.equal(
      hotReloadedService.isDailyNoteMetadataCacheReady(),
      false,
      'a new metadata generation must clear the hot-reload readiness snapshot until it settles',
    );
    await metadataEvents.get('resolved').callback();
    assert.equal(hotReloadedService.isDailyNoteMetadataCacheReady(), true);

    const apiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
    const findForIsoDateSource = apiSource.match(/findForIsoDate:[\s\S]*?dateForFile:/u)?.[0] || '';
    assert.match(findForIsoDateSource, /findCanonicalDailyNoteForIsoDate/u);
    assert.match(findForIsoDateSource, /if \(canonical\) return canonical/u);
    assert.match(findForIsoDateSource, /dailyNoteIdentityReady\(\)/u);
    assert.match(findForIsoDateSource, /findExistingDailyNoteForIsoDate/u);
    assert.match(apiSource, /dateForFile:[\s\S]{0,180}dailyNoteIdentityReady\(\)/u);
    assert.match(apiSource, /getTaskSchedulePolicy:[\s\S]{0,220}dailyNoteIdentityReady\(\)/u);
    assert.match(apiSource, /pathForIsoDate:[\s\S]{0,160}refreshDailyNoteConfiguration\(\)/u);
    assert.doesNotMatch(apiSource.match(/pathForIsoDate:[\s\S]*?ensureForIsoDate:/u)?.[0] || '', /dailyNoteIdentityReady/u);
    assert.match(apiSource, /ensureForIsoDate:[\s\S]{0,1200}refreshDailyNoteConfiguration\(\)/u);
  } finally {
    globalThis.window = priorWindow;
  }
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

test('canonical Daily Note instances never inherit the configured template tag', async () => {
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
  const templateContent = [
    '---',
    'title: "{{date:dddd}} planning"',
    'tags: [before, template, template/example, after]',
    'kind: dailynote',
    'scheduled: "{{date}} 00:00:00"',
    '---',
    '',
    '#template remains body content',
    '',
    '<% daily-body %>',
    '',
  ].join('\n');
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templateContent,
    templaterAutoTrigger: true,
    templaterTransform(content) {
      return content
        .replace('tags: [before, template/example, after]', 'tags: [before, template, template/example, after]')
        .replace('<% daily-body %>', 'Templater body');
    },
  });
  harness.plugin.settings.templateIdentificationTag = 'template';
  const service = new NoteOperationService(harness.plugin);

  const created = await service.ensureDailyNote('2026-07-28 00:00:00');
  assert.ok(created);
  assert.equal(harness.files.get('Templates/Daily.md'), templateContent, 'the template source remains byte-identical');
  const output = harness.files.get(created.path);
  assert.doesNotMatch(output, /(?:^|[\[,\s])template(?:[\],\s]|$)/imu, 'the exact marker is stripped again after Templater');
  assert.match(output, /before/u);
  assert.match(output, /template\/example/u);
  assert.match(output, /after/u);
  assert.match(output, /#template remains body content/u);
  assert.match(output, /Templater body/u);
});

test('canonical GCM creation fails closed when legacy Daily Note identity is ambiguous', async () => {
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
    runtimeDailyNotes: {
      folder: 'Daily',
      format: 'YYYY_MM_DD',
      template: 'Templates/Daily',
    },
  });
  harness.seedExternalCreation('Daily/2026-07-28.md', [
    '---',
    'kind: dailynote',
    'scheduled: 2026-07-28 00:00:00',
    '---',
  ].join('\n'));
  harness.seedExternalCreation('Daily/Planning 2026-07-28.md', [
    '---',
    'tags: daily-note',
    'scheduled: 2026-07-28 00:00:00',
    '---',
  ].join('\n'));

  const service = new NoteOperationService(harness.plugin);
  const resolved = await service.ensureDailyNote('2026-07-28 00:00:00');

  assert.equal(resolved, null);
  assert.equal(harness.stats.createCount, 0, 'ambiguity must not create a third Daily Note');
  assert.equal(harness.files.has('Daily/2026_07_28.md'), false);
});

test('canonical GCM creation rechecks legacy identity after async template work', async () => {
  installDailyNoteMoment();
  const { NoteOperationService, invalidateDailyNoteCandidateIndex } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
      const slash = path.lastIndexOf('/');
      this.parent = { path: slash >= 0 ? path.slice(0, slash) : '/' };
    }
  }
  let injected = false;
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes: {
      folder: 'Daily',
      format: 'YYYY_MM_DD',
      template: 'Templates/Daily',
    },
    beforeRead({ app, file, files, fileTimes, emitVault }) {
      if (injected || file.path !== 'Templates/Daily.md') return;
      injected = true;
      const content = [
        '---',
        'kind: dailynote',
        'scheduled: 2026-07-29 00:00:00',
        '---',
      ].join('\n');
      files.set('Daily/2026-07-29.md', content);
      files.set('Daily/Planning 2026-07-29.md', content);
      fileTimes.set('Daily/2026-07-29.md', Date.now());
      fileTimes.set('Daily/Planning 2026-07-29.md', Date.now());
      emitVault('create', new FakeFile('Daily/2026-07-29.md'));
      emitVault('create', new FakeFile('Daily/Planning 2026-07-29.md'));
      invalidateDailyNoteCandidateIndex(app);
    },
  });

  const service = new NoteOperationService(harness.plugin);
  const resolved = await service.ensureDailyNote('2026-07-29 00:00:00');

  assert.equal(resolved, null);
  assert.equal(harness.stats.createCount, 0, 'late ambiguity must not create a canonical Daily Note');
  assert.equal(harness.files.has('Daily/2026_07_29.md'), false);
});

test('canonical creation aborts when the authoritative configuration changes before mutation', async () => {
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
  const runtimeDailyNotes = {
    folder: 'Daily',
    format: 'YYYY-MM-DD',
    template: 'Templates/Daily',
  };
  let changed = false;
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes,
    beforeRead({ file }) {
      if (changed || file.path !== 'Templates/Daily.md') return;
      changed = true;
      runtimeDailyNotes.folder = 'New Daily';
    },
  });
  const service = new NoteOperationService(harness.plugin);
  assert.equal(await service.ensureDailyNote(
    '2026-08-12 00:00:00',
    { expectedPath: 'Daily/2026-08-12.md' },
  ), null);
  assert.equal(harness.stats.createCount, 0);
  assert.equal(harness.files.has('Daily/2026-08-12.md'), false);
  assert.equal(harness.files.has('New Daily/2026-08-12.md'), false);
});

test('mixed constrained and unconstrained ensures share one ISO-date mutation owner', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const runtimeDailyNotes = {
    folder: 'Daily',
    format: 'YYYY-MM-DD',
    template: 'Templates/Daily',
  };
  let releaseTemplateRead;
  const templateReadReleased = new Promise((resolve) => { releaseTemplateRead = resolve; });
  let templateReadEntered;
  const templateReadStarted = new Promise((resolve) => { templateReadEntered = resolve; });
  let blocked = false;
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes,
    async beforeRead({ file }) {
      if (blocked || file.path !== 'Templates/Daily.md') return;
      blocked = true;
      templateReadEntered();
      await templateReadReleased;
    },
  });
  const service = new NoteOperationService(harness.plugin);
  const constrained = service.ensureDailyNote(
    '2026-08-12 00:00:00',
    { expectedPath: 'Daily/2026-08-12.md' },
  );
  await templateReadStarted;
  runtimeDailyNotes.folder = 'New Daily';
  const unconstrained = service.ensureDailyNote('2026-08-12 00:00:00');
  releaseTemplateRead();

  const [constrainedResult, unconstrainedResult] = await Promise.all([constrained, unconstrained]);
  assert.equal(constrainedResult, null);
  assert.equal(unconstrainedResult?.path, 'New Daily/2026-08-12.md');
  assert.equal(harness.stats.createCount, 1, 'the ordinary joiner retries only after the first owner releases');
  assert.equal(harness.files.has('Daily/2026-08-12.md'), false);
  assert.equal(harness.files.has('New Daily/2026-08-12.md'), true);
});

test('an expected-path joiner independently rejects an ordinary owner result', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  let releaseTemplateRead;
  const templateReadReleased = new Promise((resolve) => { releaseTemplateRead = resolve; });
  let templateReadEntered;
  const templateReadStarted = new Promise((resolve) => { templateReadEntered = resolve; });
  let blocked = false;
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes: {
      folder: 'New Daily',
      format: 'YYYY-MM-DD',
      template: 'Templates/Daily',
    },
    async beforeRead({ file }) {
      if (blocked || file.path !== 'Templates/Daily.md') return;
      blocked = true;
      templateReadEntered();
      await templateReadReleased;
    },
  });
  const service = new NoteOperationService(harness.plugin);
  const ordinary = service.ensureDailyNote('2026-08-13 00:00:00');
  await templateReadStarted;
  const constrained = service.ensureDailyNote(
    '2026-08-13 00:00:00',
    { expectedPath: 'Old Daily/2026-08-13.md' },
  );
  releaseTemplateRead();

  const [ordinaryResult, constrainedResult] = await Promise.all([ordinary, constrained]);
  assert.equal(ordinaryResult?.path, 'New Daily/2026-08-13.md');
  assert.equal(constrainedResult, null);
  assert.equal(harness.stats.createCount, 1);
});

test('provider expected path rejects a configuration changed before GCM starts', async () => {
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
      folder: 'New Daily',
      format: 'YYYY-MM-DD',
      template: 'Templates/Daily',
    },
  });
  const service = new NoteOperationService(harness.plugin);
  assert.equal(await service.ensureDailyNote(
    '2026-08-12 00:00:00',
    { expectedPath: '/Daily/2026-08-12.md' },
  ), null);
  assert.equal(harness.stats.createCount, 0);
  assert.equal(harness.files.has('Daily/2026-08-12.md'), false);
  assert.equal(harness.files.has('New Daily/2026-08-12.md'), false);
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

test('authoritative non-Daily exact-path collisions are never accepted as Daily Notes', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const projectContent = [
    '---',
    'kind: project',
    'scheduled: 2026-08-18 00:00:00',
    '---',
    'Project content',
  ].join('\n');

  let adapterCollisionInjected = false;
  const adapterCollision = createDailyNoteServiceHarness(FakeFile, {
    beforeAdapterExists({ path, files, fileTimes, emitVault, fileFor }) {
      if (adapterCollisionInjected || path !== 'Daily/2026-08-18.md') return;
      adapterCollisionInjected = true;
      files.set(path, projectContent);
      fileTimes.set(path, Date.now());
      emitVault('create', fileFor(path));
    },
  });
  const adapterService = new NoteOperationService(adapterCollision.plugin);
  assert.equal(await adapterService.ensureDailyNote('2026-08-18 00:00:00'), null);
  assert.equal(adapterCollision.files.get('Daily/2026-08-18.md'), projectContent);
  assert.equal(adapterCollision.stats.createCount, 0);

  const createCollision = createDailyNoteServiceHarness(FakeFile, {
    simulateCreateRace: true,
    simulateCreateRaceContent: projectContent.replace(/2026-08-18/gu, '2026-08-19'),
  });
  const createService = new NoteOperationService(createCollision.plugin);
  assert.equal(await createService.ensureDailyNote('2026-08-19 00:00:00'), null);
  assert.match(createCollision.files.get('Daily/2026-08-19.md'), /kind: project/u);
  assert.equal(createCollision.stats.createCount, 1);
});

test('current bytes veto stale-cache non-Daily canonical and legacy candidates without Templater', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const projectContent = (date) => [
    '---',
    'kind: project',
    `scheduled: ${date} 00:00:00`,
    '---',
    'Project content',
  ].join('\n');

  const canonicalPath = 'Daily/2026-08-27.md';
  const canonicalHarness = createDailyNoteServiceHarness(FakeFile, {
    templaterLocalAutoTrigger: false,
    metadataFrontmatterOverride(file) {
      return file.path === canonicalPath ? { kind: 'dailynote' } : undefined;
    },
  });
  const canonicalBytes = projectContent('2026-08-27');
  canonicalHarness.seedExisting(canonicalPath, canonicalBytes, 20_000);
  const canonicalService = new NoteOperationService(canonicalHarness.plugin);
  assert.equal(await canonicalService.ensureDailyNote('2026-08-27 00:00:00'), null);
  assert.equal(canonicalHarness.files.get(canonicalPath), canonicalBytes);
  assert.equal(canonicalHarness.stats.createCount, 0);

  const legacyPath = '2026-08-28.md';
  const legacyHarness = createDailyNoteServiceHarness(FakeFile, {
    templaterLocalAutoTrigger: false,
    metadataFrontmatterOverride(file) {
      return file.path === legacyPath ? { kind: 'dailynote' } : undefined;
    },
  });
  const legacyBytes = projectContent('2026-08-28');
  legacyHarness.seedExisting(legacyPath, legacyBytes, 20_000);
  const legacyService = new NoteOperationService(legacyHarness.plugin);
  assert.equal(await legacyService.ensureDailyNote('2026-08-28 00:00:00'), null);
  assert.equal(legacyHarness.files.get(legacyPath), legacyBytes);
  assert.equal(legacyHarness.files.has('Daily/2026-08-28.md'), false);
  assert.equal(legacyHarness.stats.createCount, 0);
});

test('current companion markers veto stale-cache canonical return and moved-legacy reconciliation', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const companionBytes = (date) => [
    '---',
    'tpsGcmFileProperties: 1',
    `tpsGcmFileId: companion-${date}`,
    'tpsGcmSourcePath: Assets/Source.canvas',
    'kind: dailynote',
    `scheduled: ${date} 00:00:00`,
    '---',
    'Moved companion body',
  ].join('\n');

  const canonicalDate = '2026-09-04';
  const canonicalPath = `Daily/${canonicalDate}.md`;
  const canonicalHarness = createDailyNoteServiceHarness(FakeFile, {
    templaterLocalAutoTrigger: false,
    metadataFrontmatterOverride(file) {
      return file.path === canonicalPath ? { kind: 'dailynote' } : undefined;
    },
  });
  canonicalHarness.seedExisting(canonicalPath, companionBytes(canonicalDate), 20_000);
  const canonicalService = new NoteOperationService(canonicalHarness.plugin);
  assert.equal(await canonicalService.ensureDailyNote(`${canonicalDate} 00:00:00`), null);
  assert.equal(canonicalHarness.files.get(canonicalPath), companionBytes(canonicalDate));
  assert.equal(canonicalHarness.stats.createCount, 0);

  const legacyDate = '2026-09-05';
  const legacyPath = 'Moved file properties companion.md';
  const legacyHarness = createDailyNoteServiceHarness(FakeFile, {
    templaterLocalAutoTrigger: false,
    metadataFrontmatterOverride(file) {
      return file.path === legacyPath
        ? { kind: 'dailynote', scheduled: `${legacyDate} 00:00:00` }
        : undefined;
    },
  });
  legacyHarness.seedExisting(legacyPath, companionBytes(legacyDate), 20_000);
  const legacyService = new NoteOperationService(legacyHarness.plugin);
  assert.equal(await legacyService.ensureDailyNote(`${legacyDate} 00:00:00`), null);
  assert.equal(legacyHarness.files.get(legacyPath), companionBytes(legacyDate));
  assert.equal(legacyHarness.files.has(`Daily/${legacyDate}.md`), false);
  assert.equal(legacyHarness.stats.createCount, 0);
});

test('a dirty live Daily Note overrides stale-negative cache before canonical creation', async () => {
  installDailyNoteMoment();
  const { NoteOperationService, markDailyNoteCandidatePathDirty } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const legacyPath = 'Planning journal.md';
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templaterLocalAutoTrigger: false,
    metadataFrontmatterOverride(file) {
      return file.path === legacyPath ? { kind: 'project' } : undefined;
    },
  });
  const liveBytes = [
    '---',
    'kind: dailynote',
    'scheduled: 2026-08-29 00:00:00',
    '---',
    'Live Daily Note body',
  ].join('\n');
  const legacy = harness.seedExisting(legacyPath, liveBytes, 20_000);
  markDailyNoteCandidatePathDirty(harness.plugin.app, legacy);

  const service = new NoteOperationService(harness.plugin);
  const resolved = await service.ensureDailyNote('2026-08-29 00:00:00');
  assert.equal(resolved?.path, 'Daily/2026-08-29.md');
  assert.equal(harness.stats.createCount, 0, 'the stale-negative cache must not permit a duplicate create');
  assert.equal(harness.files.has(legacyPath), false);
  assert.equal(harness.files.get('Daily/2026-08-29.md'), liveBytes);
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

for (const scenario of [
  {
    label: 'non-Daily kind',
    date: '2026-08-24',
    transform(content) {
      return `\uFEFF${content
        .replace('kind: dailynote', 'kind: task')
        .replace('<% daily-body %>', 'Processed as a task')}`;
    },
    expected: /kind: task/u,
  },
  {
    label: 'process-run marker',
    date: '2026-08-25',
    transform(content) {
      return content
        .replace('kind: dailynote', 'kind: dailynote\nrunKind: run')
        .replace('<% daily-body %>', 'Processed as a run');
    },
    expected: /runKind: run/u,
  },
]) {
  test(`external Templater settlement rejects a live ${scenario.label} despite stale Daily Note metadata`, async () => {
    installDailyNoteMoment();
    const { NoteOperationService } = await loadNoteOperationService();
    class FakeFile {
      constructor(path) {
        this.path = path;
        this.extension = path.split('.').pop();
        this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
        this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
      }
    }
    const harness = createDailyNoteServiceHarness(FakeFile, {
      templaterLocalAutoTrigger: true,
      templaterAutoHookDelayMs: 20,
      templaterAutoHookWriteDelayMs: 80,
      templaterTransform: scenario.transform,
      metadataFrontmatterOverride: { kind: 'dailynote' },
    });
    const path = `Daily/${scenario.date}.md`;
    harness.seedExternalCreation(path, [
      '---',
      'kind: dailynote',
      '---',
      '<% daily-body %>',
    ].join('\n'));

    const service = new NoteOperationService(harness.plugin);
    assert.equal(await service.ensureDailyNote(`${scenario.date} 00:00:00`), null);
    assert.match(harness.files.get(path), scenario.expected);
    assert.equal(harness.stats.templaterAutoRuns, 1);
    assert.equal(harness.stats.templaterExplicitRuns, 0);
    assert.equal(harness.stats.createCount, 0);
  });
}

for (const scenario of [
  {
    label: 'array',
    date: '2026-09-01',
    yaml: '- kind: task',
  },
  {
    label: 'scalar',
    date: '2026-09-02',
    yaml: 'project',
  },
  {
    label: 'null',
    date: '2026-09-03',
    yaml: 'null',
  },
]) {
  test(`external Templater settlement rejects a ${scenario.label} YAML document root`, async () => {
    installDailyNoteMoment();
    const { NoteOperationService } = await loadNoteOperationService();
    class FakeFile {
      constructor(path) {
        this.path = path;
        this.extension = path.split('.').pop();
        this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
        this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
      }
    }
    const output = ['---', scenario.yaml, '---', `Processed ${scenario.label} root`].join('\n');
    const harness = createDailyNoteServiceHarness(FakeFile, {
      templaterLocalAutoTrigger: true,
      templaterAutoHookDelayMs: 20,
      templaterAutoHookWriteDelayMs: 80,
      templaterTransform: () => output,
      metadataFrontmatterOverride: { kind: 'dailynote' },
    });
    const path = `Daily/${scenario.date}.md`;
    harness.seedExternalCreation(path, [
      '---',
      'kind: dailynote',
      '---',
      '<% daily-body %>',
    ].join('\n'));

    const service = new NoteOperationService(harness.plugin);
    assert.equal(await service.ensureDailyNote(`${scenario.date} 00:00:00`), null);
    assert.equal(harness.files.get(path), output);
    assert.equal(harness.stats.templaterAutoRuns, 1);
    assert.equal(harness.stats.createCount, 0);
  });
}

test('a recent external Templater no-op remains fail-closed without rewriting mature content', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templaterLocalAutoTrigger: true,
    templaterAutoHookDelayMs: 20,
    templaterAutoHookWriteDelayMs: 80,
  });
  const original = [
    '---',
    'kind: dailynote',
    '---',
    '<% unknown-command %>',
  ].join('\n');
  const external = harness.seedExternalCreation('Daily/2026-08-20.md', original);
  const service = new NoteOperationService(harness.plugin);
  assert.equal(await service.ensureDailyNote('2026-08-20 00:00:00'), null);
  assert.equal(harness.files.get('Daily/2026-08-20.md'), original);
  await new Promise((resolve) => setTimeout(resolve, 425));
  assert.equal(
    await service.ensureDailyNote('2026-08-20 00:00:00'),
    null,
    'unchanged failed bytes must remain blocked after the recent-create window expires',
  );
  const recovered = original.replace('<% unknown-command %>', 'Recovered by the user');
  await harness.plugin.app.vault.modify(external, recovered);
  assert.equal(
    (await service.ensureDailyNote('2026-08-20 00:00:00'))?.path,
    external.path,
    'a proven external edit releases the same-session fingerprint',
  );
  assert.equal(harness.files.get('Daily/2026-08-20.md'), recovered);
  assert.equal(harness.stats.createCount, 0);
  assert.equal(harness.stats.templaterAutoRuns, 1);
  assert.equal(harness.stats.templaterExplicitRuns, 0);
});

test('external settlement failure evidence survives reconciliation to a changed Core path', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const runtimeDailyNotes = {
    folder: 'Daily',
    format: 'YYYY-MM-DD',
    template: 'Templates/Daily',
  };
  const original = [
    '---',
    'kind: dailynote',
    '---',
    '<% unknown-command %>',
  ].join('\n');
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes,
    templaterLocalAutoTrigger: true,
    templaterAutoHookDelayMs: 20,
    templaterAutoHookWriteDelayMs: 80,
  });
  const sourcePath = 'Daily/2026-09-06.md';
  const targetPath = 'Journal/2026-09-06.md';
  const external = harness.seedExternalCreation(sourcePath, original);
  const service = new NoteOperationService(harness.plugin);

  assert.equal(await service.ensureDailyNote('2026-09-06 00:00:00'), null);
  await new Promise((resolve) => setTimeout(resolve, 425));
  runtimeDailyNotes.folder = 'Journal';

  assert.equal(await service.ensureDailyNote('2026-09-06 00:00:00'), null);
  assert.equal(external.path, targetPath, 'reconciliation should preserve the stable TFile while renaming it');
  assert.equal(harness.files.has(sourcePath), false);
  assert.equal(harness.files.get(targetPath), original);
  assert.equal(harness.stats.createCount, 0);
  assert.equal(harness.stats.templaterAutoRuns, 1, 'renaming must not rerun or accept the failed template');
});

test('a transient post-hook read failure stays fail-closed and records owned failure evidence', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  let targetReads = 0;
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templaterLocalAutoTrigger: true,
    templaterAutoHookDelayMs: 20,
    templaterAutoHookWriteDelayMs: 50,
    beforeRead({ file }) {
      if (file.path !== 'Daily/2026-08-26.md') return;
      targetReads += 1;
      // First read inspects the prepared template; the second confirms that
      // the auto hook settled; the third is the post-hook equality proof.
      if (targetReads === 3) throw new Error('transient post-hook read failure');
    },
  });
  const service = new NoteOperationService(harness.plugin);
  assert.equal(await service.ensureDailyNote('2026-08-26 00:00:00'), null);
  assert.match(
    harness.files.get('Daily/2026-08-26.md'),
    /<!-- tps-daily-note-template-incomplete:v1 -->\n$/u,
  );
  assert.equal(harness.stats.templaterAutoRuns, 1);
  assert.equal(harness.stats.createCount, 1);
});

test('a mature existing Daily Note containing literal Templater syntax stays byte-for-byte unchanged', async () => {
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
  const harness = createDailyNoteServiceHarness(FakeFile, { templaterLocalAutoTrigger: true });
  const original = [
    '---',
    'title: Mature Daily Note',
    'kind: dailynote',
    '---',
    '',
    'Literal documentation: <% do not execute this %>',
    '',
  ].join('\n');
  harness.seedExisting('Daily/2026-08-06.md', original, 20_000);

  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-08-06 00:00:00');

  assert.equal(file?.path, 'Daily/2026-08-06.md');
  assert.equal(harness.files.get(file.path), original);
  assert.equal(harness.stats.createCount, 0);
  assert.equal(harness.stats.templaterRuns, 0);
});

test('a reconciled legacy Daily Note keeps its bytes while only its path changes', async () => {
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
      folder: 'Daily',
      format: 'YYYY_MM_DD',
      template: 'Templates/Daily',
    },
    templaterLocalAutoTrigger: true,
  });
  const original = [
    '---',
    'title: Legacy Daily Note',
    'kind: dailynote',
    'scheduled: 2026-08-07 00:00:00',
    '---',
    '',
    'Literal documentation: <% do not execute this %>',
    '',
  ].join('\n');
  harness.seedExisting('Daily/2026-08-07.md', original, 20_000);

  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-08-07 00:00:00');

  assert.equal(file?.path, 'Daily/2026_08_07.md');
  assert.equal(harness.files.get(file.path), original);
  assert.equal(harness.files.has('Daily/2026-08-07.md'), false);
  assert.equal(harness.stats.createCount, 0);
  assert.equal(harness.stats.templaterRuns, 0);
});

test('Templater creation eligibility mirrors upstream includes/startsWith guards', async () => {
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
  const harness = createDailyNoteServiceHarness(FakeFile);
  const service = new NoteOperationService(harness.plugin);
  const templater = {
    settings: {
      templates_folder: 'Templates',
      ignore_folders_on_creation: [{ folder: 'Archive' }],
    },
  };

  assert.equal(service.isTemplaterAutoCreateEligible(new FakeFile('Templates/Note.md'), templater), false);
  assert.equal(service.isTemplaterAutoCreateEligible(new FakeFile('Templates/Sub/Note.md'), templater), false);
  assert.equal(service.isTemplaterAutoCreateEligible(new FakeFile('MyTemplatesArchive/Note.md'), templater), false);
  assert.equal(service.isTemplaterAutoCreateEligible(new FakeFile('Archive/Note.md'), templater), false);
  assert.equal(service.isTemplaterAutoCreateEligible(new FakeFile('Archive2/Note.md'), templater), false);
});

test('a slow vault create cannot consume the passive Templater hook grace period', async () => {
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
      '---',
      '',
      'Static template body',
    ].join('\n'),
    templaterLocalAutoTrigger: true,
    createDelayMs: 450,
    templaterAutoHookDelayMs: 120,
    templaterAutoHookWriteDelayMs: 30,
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-08-08 00:00:00');

  assert.ok(file);
  assert.equal(harness.stats.templaterRuns, 1);
  assert.equal(harness.stats.templaterAutoRuns, 1);
  assert.equal(harness.stats.templaterExplicitRuns, 0);
});

test('positive Templater processing accepts intentional literal delimiters in output', async () => {
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
      '---',
      '',
      '<% daily-body %>',
      'Literal documentation: <% do not execute this example %>',
    ].join('\n'),
    templaterLocalAutoTrigger: true,
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-08-09 00:00:00');

  assert.ok(file);
  assert.match(harness.files.get(file.path), /Templater body/u);
  assert.match(harness.files.get(file.path), /<% do not execute this example %>/u);
});

test('Templater ownership still fails closed when prepared template bytes never change', async () => {
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
      '',
      '---',
      'kind: dailynote',
      '---',
      '',
      '<% unknown-command %>',
    ].join('\n'),
    templaterLocalAutoTrigger: false,
  });
  const service = new NoteOperationService(harness.plugin);
  assert.equal(await service.ensureDailyNote('2026-08-13 00:00:00'), null);
  assert.match(
    harness.files.get('Daily/2026-08-13.md'),
    /<!-- tps-daily-note-template-incomplete:v1 -->\n$/u,
  );
  assert.match(
    harness.files.get('Daily/2026-08-13.md'),
    /^\n---\n/u,
    'GCM normalization must not manufacture evidence that an explicit Templater pass succeeded',
  );
});

test('auto Templater no-op with leading whitespace remains fail-closed before normalization', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templateContent: [
      '',
      '---',
      'kind: dailynote',
      '---',
      '<% unknown-command %>',
    ].join('\n'),
    templaterLocalAutoTrigger: true,
  });
  const service = new NoteOperationService(harness.plugin);
  assert.equal(await service.ensureDailyNote('2026-08-17 00:00:00'), null);
  const failed = harness.files.get('Daily/2026-08-17.md');
  assert.match(failed, /^\n---\n/u);
  assert.match(failed, /<!-- tps-daily-note-template-incomplete:v1 -->\n$/u);
});

test('leading frontmatter normalization atomically transforms the current vault bytes', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  let concurrentEditApplied = false;
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templateContent: [
      '',
      '---',
      'kind: dailynote',
      '---',
      '<% daily-body %>',
    ].join('\n'),
    beforeProcess({ file, files }) {
      if (concurrentEditApplied || file.path !== 'Daily/2026-08-14.md') return;
      concurrentEditApplied = true;
      files.set(file.path, [
        '',
        '---',
        'kind: dailynote',
        '---',
        'Concurrent Sync edit',
      ].join('\n'));
    },
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-08-14 00:00:00');
  assert.ok(file);
  const current = harness.files.get(file.path);
  assert.match(current, /^---\n/u);
  assert.match(current, /Concurrent Sync edit/u, 'normalization must preserve the live concurrent bytes');
});

test('owned static and Templater outputs must retain Daily Note identity before return', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }

  const staticHarness = createDailyNoteServiceHarness(FakeFile, {
    templateContent: [
      '---',
      'kind: project',
      '---',
      'Static project output',
    ].join('\n'),
  });
  const staticService = new NoteOperationService(staticHarness.plugin);
  assert.equal(await staticService.ensureDailyNote('2026-08-21 00:00:00'), null);
  assert.match(staticHarness.files.get('Daily/2026-08-21.md'), /kind: "project"/u);
  assert.equal(staticHarness.stats.createCount, 1, 'invalid owned output is preserved for inspection');

  const templaterHarness = createDailyNoteServiceHarness(FakeFile, {
    templateContent: [
      '---',
      'kind: dailynote',
      '---',
      '<% daily-body %>',
    ].join('\n'),
    templaterLocalAutoTrigger: false,
    metadataFrontmatterOverride: { kind: 'dailynote' },
    afterOwnedFrontmatterProcess({ file, files }) {
      const current = files.get(file.path);
      if (!current.startsWith('\uFEFF')) files.set(file.path, `\uFEFF${current}`);
    },
    templaterTransform(content) {
      return content
        .replace('kind: dailynote', 'kind: task')
        .replace('<% daily-body %>', 'Processed as a task');
    },
  });
  const templaterService = new NoteOperationService(templaterHarness.plugin);
  assert.equal(await templaterService.ensureDailyNote('2026-08-22 00:00:00'), null);
  assert.match(templaterHarness.files.get('Daily/2026-08-22.md'), /^\uFEFF---\n/u);
  assert.match(templaterHarness.files.get('Daily/2026-08-22.md'), /kind: "task"/u);
  assert.match(templaterHarness.files.get('Daily/2026-08-22.md'), /Processed as a task/u);
  assert.equal(templaterHarness.stats.createCount, 1);

  const processHarness = createDailyNoteServiceHarness(FakeFile, {
    templateContent: [
      '---',
      'kind: dailynote',
      'runKind: run',
      '---',
      'Process output',
    ].join('\n'),
    metadataFrontmatterOverride: { kind: 'dailynote' },
  });
  const processService = new NoteOperationService(processHarness.plugin);
  assert.equal(await processService.ensureDailyNote('2026-08-23 00:00:00'), null);
  assert.match(processHarness.files.get('Daily/2026-08-23.md'), /runKind: "run"/u);
  assert.equal(processHarness.stats.createCount, 1);
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

test('an incomplete owned template creation remains fail-closed on retry without deleting the file', async () => {
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
    templaterAvailable: false,
  });
  const service = new NoteOperationService(harness.plugin);
  assert.equal(await service.ensureDailyNote('2026-08-10 00:00:00'), null);
  assert.equal(harness.files.has('Daily/2026-08-10.md'), true);
  const failedContent = harness.files.get('Daily/2026-08-10.md');
  assert.match(failedContent, /^---\n/u, 'the durable marker must preserve YAML frontmatter at byte zero');
  assert.match(failedContent, /<!-- tps-daily-note-template-incomplete:v1 -->\n$/u);
  await new Promise((resolve) => setTimeout(resolve, 425));
  assert.equal(await service.ensureDailyNote('2026-08-10 00:00:00'), null);
  const afterReload = new NoteOperationService(harness.plugin);
  assert.equal(await afterReload.ensureDailyNote('2026-08-10 00:00:00'), null);
  assert.equal(harness.stats.createCount, 1, 'retry must not reuse or recreate the incomplete file');
  const source = readFileSync(new URL('../src/services/note-operation-service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /rollbackIncompleteOwnedDailyNote|\.trash\(/u);
});

test('deliberately removing the durable incomplete marker recovers in the same session', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const harness = createDailyNoteServiceHarness(FakeFile, { templaterAvailable: false });
  const service = new NoteOperationService(harness.plugin);
  const path = 'Daily/2026-08-15.md';
  assert.equal(await service.ensureDailyNote('2026-08-15 00:00:00'), null);
  assert.match(harness.files.get(path), /tps-daily-note-template-incomplete/u);
  harness.files.set(
    path,
    harness.files.get(path).replace(/\n?<!-- tps-daily-note-template-incomplete:v1 -->\n?$/u, '\n'),
  );
  assert.equal((await service.ensureDailyNote('2026-08-15 00:00:00'))?.path, path);
  assert.equal(harness.stats.createCount, 1);
});

test('an unreadable failure-state fingerprint remains unconditionally blocked for the session', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  let targetReads = 0;
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templaterAvailable: false,
    beforeRead({ file }) {
      if (file.path !== 'Daily/2026-08-16.md') return;
      targetReads += 1;
      if (targetReads === 2) throw new Error('transient failure-state read error');
    },
  });
  const service = new NoteOperationService(harness.plugin);
  assert.equal(await service.ensureDailyNote('2026-08-16 00:00:00'), null);
  assert.doesNotMatch(harness.files.get('Daily/2026-08-16.md'), /tps-daily-note-template-incomplete/u);
  assert.equal(await service.ensureDailyNote('2026-08-16 00:00:00'), null);
  assert.equal(harness.stats.createCount, 1);
});

test('durable incomplete marking never overwrites a concurrent user edit', async () => {
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
  let changed = false;
  const harness = createDailyNoteServiceHarness(FakeFile, {
    templaterAvailable: false,
    beforeProcess({ file, files }) {
      if (changed) return;
      changed = true;
      files.set(file.path, `${files.get(file.path)}\nConcurrent user edit\n`);
    },
  });
  const service = new NoteOperationService(harness.plugin);
  assert.equal(await service.ensureDailyNote('2026-08-11 00:00:00'), null);
  const content = harness.files.get('Daily/2026-08-11.md');
  assert.match(content, /Concurrent user edit/u);
  assert.doesNotMatch(content, /tps-daily-note-template-incomplete/u);
});

for (const [label, processOptions] of [
  ['unavailable', { vaultProcessAvailable: false }],
  ['throwing', { vaultProcessError: new Error('process failed') }],
]) {
  test(`same-session incomplete creation stays blocked when vault.process is ${label}`, async () => {
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
      templaterAvailable: false,
      ...processOptions,
    });
    const service = new NoteOperationService(harness.plugin);
    assert.equal(await service.ensureDailyNote('2026-08-12 00:00:00'), null);
    const rejected = harness.files.get('Daily/2026-08-12.md');
    assert.doesNotMatch(rejected, /tps-daily-note-template-incomplete/u);
    assert.equal(await service.ensureDailyNote('2026-08-12 00:00:00'), null);
    assert.equal(harness.files.get('Daily/2026-08-12.md'), rejected);
    assert.equal(harness.stats.createCount, 1);

    harness.files.set('Daily/2026-08-12.md', `${rejected}\nUser recovery edit\n`);
    assert.ok(await service.ensureDailyNote('2026-08-12 00:00:00'));
  });
}

test('marker-unavailable owned failure evidence survives reconciliation to a changed Core path', async () => {
  installDailyNoteMoment();
  const { NoteOperationService } = await loadNoteOperationService();
  class FakeFile {
    constructor(path) {
      this.path = path;
      this.extension = path.split('.').pop();
      this.basename = path.split('/').pop().replace(/\.[^.]+$/u, '');
      this.parent = { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/' };
    }
  }
  const runtimeDailyNotes = {
    folder: 'Daily',
    format: 'YYYY-MM-DD',
    template: 'Templates/Daily',
  };
  const harness = createDailyNoteServiceHarness(FakeFile, {
    runtimeDailyNotes,
    templaterAvailable: false,
    vaultProcessAvailable: false,
  });
  const sourcePath = 'Daily/2026-09-07.md';
  const targetPath = 'Journal/2026-09-07.md';
  const service = new NoteOperationService(harness.plugin);

  assert.equal(await service.ensureDailyNote('2026-09-07 00:00:00'), null);
  const rejected = harness.files.get(sourcePath);
  assert.doesNotMatch(rejected, /tps-daily-note-template-incomplete/u);
  runtimeDailyNotes.folder = 'Journal';

  assert.equal(await service.ensureDailyNote('2026-09-07 00:00:00'), null);
  assert.equal(harness.files.has(sourcePath), false);
  assert.equal(harness.files.get(targetPath), rejected);
  assert.equal(harness.stats.createCount, 1, 'renaming must not recreate or accept failed owned bytes');
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

test('partial runtime Daily Notes settings recover one coherent persisted snapshot', async () => {
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

  assert.equal(file.path, 'Stale/Persisted/2026_07_28.md');
  assert.match(harness.files.get(file.path), /Tuesday planning/);
  assert.match(harness.files.get(file.path), /Templater body/);
  assert.equal(harness.stats.templaterRuns, 1);
});

test('a transient blank runtime configuration cannot split the saved Daily Notes identity', async () => {
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
      folder: 'Persisted/Daily',
      format: 'YYYY_MM_DD',
      template: 'Templates/Daily',
    },
  });
  const service = new NoteOperationService(harness.plugin);
  const file = await service.ensureDailyNote('2026-07-29 00:00:00');

  assert.equal(file.path, 'Persisted/Daily/2026_07_29.md');
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

test('generic title synchronization checks workflow ownership only at a real mutation boundary', async () => {
  const priorWindow = globalThis.window;
  const invalidMoment = () => ({ isValid: () => false, format: () => '' });
  invalidMoment.ISO_8601 = Symbol('ISO_8601');
  globalThis.window = { ...priorWindow, moment: invalidMoment };

  try {
    const { FileNamingService } = await loadFileNamingService();
    const file = {
      __isTestTFile: true,
      path: 'Inbox/Already matching.md',
      name: 'Already matching.md',
      basename: 'Already matching',
      extension: 'md',
      parent: { path: 'Inbox' },
      stat: { ctime: 0, mtime: 0 },
    };
    let source = '---\ntitle: Already matching\nkind: note\n---\n';
    let cachedFrontmatter = { title: 'Already matching', kind: 'note' };
    let cachedReads = 0;
    let authoritativeReads = 0;
    let identityChecks = 0;
    let renamed = 0;
    let titleMutations = 0;
    let authoritativeReadGate = null;
    let signalAuthoritativeRead = null;
    let releaseAuthoritativeRead = null;

    const refreshFileIdentity = (path) => {
      file.path = path;
      file.name = path.split('/').pop();
      file.basename = file.name.replace(/\.md$/u, '');
      const slash = path.lastIndexOf('/');
      file.parent = { path: slash >= 0 ? path.slice(0, slash) : '/' };
    };
    const plugin = {
      settings: {
        autoSyncTitleFromFilename: true,
        enableAutoRename: true,
        folderExclusions: '',
        dailyNoteDateFormat: 'YYYY-MM-DD',
      },
      registerEvent() {},
      shouldIgnoreAutoFrontmatterWrite: () => false,
      nativeRecordService: {
        isRecordFile: () => false,
        async hasRecordIdentityEvidence(_file, authoritativeSource) {
          identityChecks += 1;
          return /(?:^|\n)tpsId\s*:/u.test(String(authoritativeSource || ''));
        },
      },
      bulkEditService: {
        shouldSkipNoteLevelRecurrence: async () => false,
        canMutateFrontmatterSafely: async () => true,
        runSerializedFrontmatterWrite: async (_file, action) => action(),
      },
      frontmatterMutationService: {
        async process() {
          titleMutations += 1;
          return true;
        },
      },
      app: {
        internalPlugins: { getPluginById: () => null, plugins: {} },
        plugins: { getPlugin: () => null, plugins: {} },
        vault: {
          configDir: '.obsidian',
          adapter: { async read() { throw new Error('missing Daily Notes settings'); } },
          getFiles: () => [file],
          getMarkdownFiles: () => [file],
          getAbstractFileByPath: (path) => path === file.path ? file : null,
          getFileByPath: (path) => path === file.path ? file : null,
          cachedRead: async () => {
            cachedReads += 1;
            return source;
          },
          read: async () => {
            authoritativeReads += 1;
            signalAuthoritativeRead?.();
            if (authoritativeReadGate) await authoritativeReadGate;
            return source;
          },
          on: () => ({}),
        },
        metadataCache: {
          initialized: true,
          getFileCache: () => ({ frontmatter: cachedFrontmatter }),
          on: () => ({}),
        },
        fileManager: {
          async renameFile(_file, nextPath) {
            renamed += 1;
            refreshFileIdentity(nextPath);
          },
        },
      },
    };
    const service = new FileNamingService(plugin);
    await service.whenDailyNoteConfigurationReady();

    await service.updateFilenameIfNeeded(file, { bypassCreationGrace: true });
    assert.equal(identityChecks, 0, 'an already-canonical filename needs no authoritative identity read');
    assert.equal(authoritativeReads, 0);

    refreshFileIdentity('Inbox/Old path.md');
    source = '---\ntitle: New path\nkind: note\n---\n';
    cachedFrontmatter = { title: 'New path', kind: 'note' };
    authoritativeReadGate = new Promise((resolve) => { releaseAuthoritativeRead = resolve; });
    const authoritativeReadStarted = new Promise((resolve) => { signalAuthoritativeRead = resolve; });
    const racingRename = service.updateFilenameIfNeeded(file, { bypassCreationGrace: true });
    await authoritativeReadStarted;
    assert.ok(cachedReads > 0, 'identity is rechecked after the candidate rename has been derived');
    assert.equal(renamed, 0);
    source = [
      '---',
      'tpsId: workout-became-native',
      'tpsSchemaVersion: 1',
      'kind: workout-session',
      'title: New path',
      '---',
      '',
    ].join('\n');
    releaseAuthoritativeRead();
    await racingRename;
    assert.equal(renamed, 0, 'identity acquired before the mutation boundary prevents the rename');

    authoritativeReadGate = null;
    signalAuthoritativeRead = null;
    releaseAuthoritativeRead = null;
    refreshFileIdentity('Inbox/2026-08-31 - Workout 07.04.md');
    source = [
      '---',
      'kind: workout',
      'workoutId: workout-legacy',
      'title: Workout 2026-08-31 07.04',
      '---',
      '',
    ].join('\n');
    cachedFrontmatter = { kind: 'workout', workoutId: 'workout-legacy', title: 'Workout 2026-08-31 07.04' };
    const workoutReadBaseline = authoritativeReads;
    await service.updateFilenameIfNeeded(file, { bypassCreationGrace: true });
    assert.ok(authoritativeReads > workoutReadBaseline, 'Legacy workflow ownership is read from current bytes');
    assert.equal(renamed, 0, 'a date-first Legacy workout keeps its workflow-owned filename');

    const titleReadBaseline = authoritativeReads;
    const titleResult = await service.syncTitleFromFilename(file, {
      force: true,
      bypassCreationGrace: true,
    });
    assert.equal(titleResult, undefined, 'the public title-sync method keeps its void contract');
    assert.ok(authoritativeReads > titleReadBaseline, 'title writes use the same current-byte ownership boundary');
    assert.equal(titleMutations, 0, 'Legacy workout identity also blocks filename-derived title writes');

    refreshFileIdentity('Inbox/Ordinary old name.md');
    source = '---\ntitle: Ordinary new name\nkind: note\n---\n';
    cachedFrontmatter = { title: 'Ordinary new name', kind: 'note' };
    await service.updateFilenameIfNeeded(file, { bypassCreationGrace: true });
    assert.equal(renamed, 1, 'ordinary notes retain title-derived renaming');
    assert.equal(file.path, 'Inbox/Ordinary new name.md');

    refreshFileIdentity('Inbox/Blueprint old name.md');
    source = '---\ntitle: Blueprint new name\ntags: [template]\nkind: note\n---\n';
    cachedFrontmatter = { title: 'Blueprint new name', kind: 'note' };
    await service.updateFilenameIfNeeded(file, { bypassCreationGrace: true });
    assert.equal(renamed, 1, 'current source bytes protect a template even when metadata cache is stale');
    assert.equal(file.path, 'Inbox/Blueprint old name.md');

    const templateTitleMutations = titleMutations;
    source = '---\ntitle: Stale title\ntags: [template]\nkind: note\n---\n';
    cachedFrontmatter = { title: 'Stale title', kind: 'note' };
    await service.syncTitleFromFilename(file, { force: true, bypassCreationGrace: true });
    assert.equal(titleMutations, templateTitleMutations, 'filename-derived title repair also protects template sources');
  } finally {
    globalThis.window = priorWindow;
  }
});

test('timestamp sync rejects native identity evidence acquired at the source-preserving mutation boundary', async () => {
  const priorWindow = globalThis.window;
  const timestampMoment = () => ({
    isValid: () => true,
    format: () => '2026-08-31 12:34:56',
    valueOf: () => Date.now(),
  });
  timestampMoment.ISO_8601 = Symbol('ISO_8601');
  globalThis.window = { ...priorWindow, moment: timestampMoment };

  try {
    const { FileNamingService } = await loadFileNamingService();
    const cases = [
      {
        label: 'valid native record',
        boundaryFrontmatter: { tpsId: 'task-valid-race', kind: 'task', title: 'Timestamp race' },
        expectedWrites: 0,
      },
      {
        label: 'incomplete native identity',
        boundaryFrontmatter: { tpsId: '', title: 'Timestamp race' },
        expectedWrites: 0,
      },
      {
        label: 'ordinary note',
        boundaryFrontmatter: { title: 'Timestamp race' },
        expectedWrites: 1,
      },
    ];

    for (const testCase of cases) {
      const file = {
        __isTestTFile: true,
        path: `Inbox/${testCase.label}.md`,
        name: `${testCase.label}.md`,
        basename: testCase.label,
        extension: 'md',
        parent: { path: 'Inbox' },
        stat: { ctime: 1_777_777_777_000, mtime: 1_777_777_888_000 },
      };
      const initialSource = '---\ntitle: Timestamp race\n---\n';
      let boundaryFrontmatter = { title: 'Timestamp race' };
      let ownedKeys = [];
      let cause = null;
      let writes = 0;
      let legacyProcessCalls = 0;
      const plugin = {
        manifest: { id: 'tps-global-context-menu' },
        settings: {
          autoSyncFileTimestamps: true,
          dateCreatedFrontmatterKey: 'createdDate',
          dateModifiedFrontmatterKey: 'modifiedDate',
          fileTimestampFormat: 'YYYY-MM-DD HH:mm:ss',
          dailyNoteDateFormat: 'YYYY-MM-DD',
        },
        registerEvent() {},
        shouldIgnoreAutoFrontmatterWrite: () => false,
        nativeRecordService: {
          hasRecordIdentityEvidenceInFrontmatter(frontmatter) {
            return Object.keys(frontmatter || {}).some((key) => (
              ['tpsid', 'tpsschemaversion'].includes(key.toLowerCase())
            ));
          },
        },
        bulkEditService: {
          canMutateFrontmatterSafely: async () => true,
          async runSerializedFrontmatterWrite(_file, action) {
            // Identity appears after every cache/source preflight. The callback
            // below is the current-byte mutation boundary and must recheck it.
            boundaryFrontmatter = { ...testCase.boundaryFrontmatter };
            await action();
          },
        },
        frontmatterMutationService: {
          async processOwnedKeysPreservingSource(_file, keys, mutator, mutationCause) {
            ownedKeys = [...keys];
            cause = mutationCause;
            const before = JSON.stringify(boundaryFrontmatter);
            mutator(boundaryFrontmatter);
            const changed = JSON.stringify(boundaryFrontmatter) !== before;
            if (changed) writes += 1;
            return changed;
          },
          async process() {
            legacyProcessCalls += 1;
            throw new Error('timestamp automation must use the atomic source-preserving writer');
          },
        },
        app: {
          internalPlugins: { getPluginById: () => null, plugins: {} },
          plugins: { getPlugin: () => null, plugins: {} },
          vault: {
            configDir: '.obsidian',
            adapter: { async read() { throw new Error('missing Daily Notes settings'); } },
            getFiles: () => [file],
            getMarkdownFiles: () => [file],
            getAbstractFileByPath: (path) => path === file.path ? file : null,
            cachedRead: async () => initialSource,
            on: () => ({}),
          },
          metadataCache: {
            initialized: true,
            getFileCache: () => ({ frontmatter: { title: 'Timestamp race' } }),
            on: () => ({}),
          },
        },
      };

      const service = new FileNamingService(plugin);
      await service.whenDailyNoteConfigurationReady();
      await service.syncFileTimestamps(file, { reason: 'modify', force: true });

      assert.deepEqual(ownedKeys, ['createdDate', 'modifiedDate'], testCase.label);
      assert.equal(cause?.surface, 'file-timestamp-sync', testCase.label);
      assert.equal(legacyProcessCalls, 0, testCase.label);
      assert.equal(writes, testCase.expectedWrites, testCase.label);
      assert.equal(Object.hasOwn(boundaryFrontmatter, 'createdDate'), testCase.expectedWrites === 1, testCase.label);
      assert.equal(Object.hasOwn(boundaryFrontmatter, 'modifiedDate'), testCase.expectedWrites === 1, testCase.label);
    }
  } finally {
    globalThis.window = priorWindow;
  }
});
