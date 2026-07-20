import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');

async function loadBulkEditService() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/bulk-edit-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'recurrence-reliability-stubs',
      setup(builder) {
        const virtual = (path, contents) => ({ path, namespace: 'recurrence-test', pluginData: contents });
        builder.onResolve({ filter: /^obsidian$/ }, () => virtual('obsidian', `
          export class TFile {
            constructor(path) {
              this.path = path;
              this.extension = path.includes('.') ? path.split('.').pop() : '';
              this.basename = path.split('/').pop().replace(/\\.[^.]+$/, '');
              const slash = path.lastIndexOf('/');
              this.parent = { path: slash >= 0 ? path.slice(0, slash) : '' };
            }
            static [Symbol.hasInstance](value) {
              return Boolean(value && typeof value.path === 'string' && typeof value.extension === 'string');
            }
          }
          export class Notice { constructor(message) { globalThis.__recurrenceNotices.push(String(message)); } }
          export const normalizePath = (value) => String(value || '').replace(/\\\\/g, '/').replace(/\\/{2,}/g, '/').replace(/^\\.\\//, '');
          const parseScalar = (raw) => {
            const value = raw.trim();
            if (value === 'true') return true;
            if (value === 'false') return false;
            if (value === 'null') return null;
            if (/^-?\\d+(?:\\.\\d+)?$/.test(value)) return Number(value);
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
              try { return JSON.parse(value); } catch { return value.slice(1, -1); }
            }
            if (value.startsWith('[') && value.endsWith(']')) {
              try { return JSON.parse(value); } catch { return value.slice(1, -1).split(',').map((item) => item.trim()).filter(Boolean); }
            }
            return value;
          };
          export const parseYaml = (yaml) => {
            const result = {};
            for (const line of String(yaml || '').split(/\\r?\\n/)) {
              if (!line.trim() || line.trimStart().startsWith('#')) continue;
              const match = line.match(/^([^:#][^:]*):(?:\\s*)(.*)$/);
              if (!match) throw new Error('unsupported yaml');
              result[match[1].trim()] = parseScalar(match[2]);
            }
            return result;
          };
          export const stringifyYaml = (record) => Object.entries(record).map(([key, value]) => {
            if (typeof value === 'string') return key + ': ' + JSON.stringify(value);
            return key + ': ' + JSON.stringify(value);
          }).join('\\n') + (Object.keys(record).length ? '\\n' : '');
        `));
        builder.onResolve({ filter: /^rrule$/ }, () => virtual('rrule', `
          export class RRule { static parseString() { return {}; } after() { return null; } }
        `));
        builder.onResolve({ filter: /^\.\.\/main$/ }, () => virtual('main', 'export default class Plugin {}'));
        builder.onResolve({ filter: /^\.\.\/logger$/ }, () => virtual('logger', `
          export const log = (...args) => globalThis.__recurrenceLogs.push(['log', ...args]);
          export const warn = (...args) => globalThis.__recurrenceLogs.push(['warn', ...args]);
          export const error = (...args) => globalThis.__recurrenceLogs.push(['error', ...args]);
          export const flow = () => undefined;
          export const flowWarn = () => undefined;
          export const flowError = () => undefined;
          export const errorSummary = (value) => value instanceof Error ? value.message : String(value);
        `));
        builder.onResolve({ filter: /^\.\.\/constants$/ }, () => virtual('constants', "export const TRACKER_RECURRENCE_RULE = 'GCM-TRACKER';"));
        builder.onResolve({ filter: /^\.\.\/utils\/tag-utils$/ }, () => virtual('tags', `
          export const normalizeTagValue = (value) => String(value || '').replace(/^#/, '').trim().toLowerCase();
          export const normalizeTagList = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
          export const parseTagInput = (value) => String(value || '').split(',').filter(Boolean);
          export const mergeNormalizedTags = (value, additions) => [...new Set([...(Array.isArray(value) ? value : []), ...additions])];
        `));
        builder.onResolve({ filter: /^\.\.\/utils\/list-utils$/ }, () => virtual('lists', `
          export const mergeLinkList = (value, additions) => [...(Array.isArray(value) ? value : []), ...additions];
          export const mergeStringList = mergeLinkList;
          export const parseLinkListInput = (value) => [String(value)];
          export const parseStringListInput = parseLinkListInput;
          export const removeLinkListValues = () => [];
          export const removeStringListValues = () => [];
        `));
        builder.onResolve({ filter: /^\.\.\/utils\/date-suffix-utils$/ }, () => virtual('date-suffix', `
          export const stripDatePrefix = (value) => String(value || '').replace(/^\\d{4}-\\d{2}-\\d{2}\\s+/, '');
          export const stripDateSuffix = (value) => String(value || '').replace(/(?:\\s+|-)\\d{4}-\\d{2}-\\d{2}$/, '');
        `));
        builder.onResolve({ filter: /^\.\.\/utils\/completed-date-utils$/ }, () => virtual('completed-date', `
          export const setCompletedDateValue = (fm) => { fm.completedDate = '2026-07-20 12:00:00'; };
        `));
        builder.onResolve({ filter: /^\.\.\/handlers\/checklist-handler$/ }, () => virtual('checklist', 'export class ChecklistHandler { async handleChecklistCompletion() { return true; } }'));
        builder.onResolve({ filter: /^\.\.\/handlers\/parent-link-handler$/ }, () => virtual('parent-handler', `
          export class ParentLinkHandler { normalizeParentKey() { return 'childOf'; } isCompletionStatus() { return false; } async handleParentLinkCompletion() { return true; } }
        `));
        builder.onResolve({ filter: /^\.\.\/handlers\/parent-link-format$/ }, () => virtual('parent-format', `
          export const buildParentFrontmatterLinkValue = () => '';
          export const buildParentLinkValue = () => '';
          export const linkValueMatchesFile = () => false;
          export const extractLinkTarget = (value) => String(value || '').replace(/^!?\\[\\[/, '').replace(/\\]\\]$/, '').split('|')[0].trim();
          export const resolveLinkValueToFile = (app, value, sourcePath) => app.metadataCache.getFirstLinkpathDest(extractLinkTarget(value), sourcePath);
        `));
        builder.onResolve({ filter: /^\.\.\/utils\/daily-note-task-schedule$/ }, () => virtual('daily-note-task', 'export const findExistingDailyNoteForIsoDate = () => null;'));
        builder.onResolve({ filter: /^\.\.\/utils\/daily-file-date$/ }, () => virtual('daily-file-date', 'export const parseDateFromFilename = () => ({ isValid: () => false });'));
        builder.onResolve({ filter: /^\.\.\/utils\/deleted-link-cleanup$/ }, () => virtual('deleted-links', `
          export const classifyDeletedMarkdownLink = () => 'none';
          export const createDeletedMarkdownLinkContext = () => null;
        `));
        builder.onResolve({ filter: /^\.\.\/core$/ }, () => virtual('core', `
          export const casefold = (value) => String(value || '').toLowerCase();
          export const findKeyCaseInsensitive = (target, key) => Object.keys(target || {}).find((candidate) => candidate.toLowerCase() === String(key).toLowerCase()) || null;
          export const setValueCaseInsensitive = (target, key, value) => { const actual = findKeyCaseInsensitive(target, key) || key; target[actual] = value; };
          export const deleteValueCaseInsensitive = (target, key) => { const actual = findKeyCaseInsensitive(target, key); if (actual) delete target[actual]; };
          export const mutateFrontmatterTagFields = () => undefined;
          export const removeInlineTagsSafely = (content) => content;
          export const runInBatches = async (items, callback) => { for (const item of items) await callback(item); };
          export const showNotice = () => undefined;
        `));
        builder.onLoad({ filter: /.*/, namespace: 'recurrence-test' }, (args) => ({
          contents: args.pluginData,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

globalThis.__recurrenceNotices = [];
globalThis.__recurrenceLogs = [];
globalThis.window = {
  moment(value) {
    return {
      isValid: () => true,
      toDate: () => value instanceof Date ? value : new Date(value || '2026-07-20T00:00:00'),
      format: (format) => format === 'YYYY-MM-DD HH:mm:ss' ? '2026-07-21 00:00:00' : '2026-07-21',
      startOf: () => ({ toDate: () => new Date('2026-07-20T00:00:00') }),
    };
  },
};

const { BulkEditService } = await loadBulkEditService();

const clone = (value) => JSON.parse(JSON.stringify(value));

function parseFrontmatter(content) {
  const match = String(content).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const row = line.match(/^([^:]+):\s*(.*)$/);
    if (!row) continue;
    try { result[row[1].trim()] = JSON.parse(row[2]); }
    catch { result[row[1].trim()] = row[2].trim(); }
  }
  return result;
}

function serializeFrontmatter(frontmatter, body = '') {
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
  return `---\n${yaml}\n---\n${body}`;
}

function createHarness(options = {}) {
  globalThis.__recurrenceNotices.length = 0;
  globalThis.__recurrenceLogs.length = 0;
  const files = new Map();
  const frontmatters = new Map();
  const contents = new Map();
  const folders = new Set(['', 'Events', 'Templates', '.obsidian/plugins/tps-global-context-menu']);
  const stateWrites = [];
  const events = [];
  let stateContent = null;
  let rejectStateWrites = Boolean(options.rejectStateWrites);
  let rejectNextStateWrite = false;
  let createError = options.createError || null;
  let guardedHook = options.guardedHook || null;
  let processHook = options.processHook || null;

  const addFile = (path, frontmatter = {}, body = '') => {
    const file = new globalThis.__RecurrenceTFile(path);
    files.set(path, file);
    frontmatters.set(path, clone(frontmatter));
    contents.set(path, serializeFrontmatter(frontmatter, body));
    if (file.parent?.path) folders.add(file.parent.path);
    return file;
  };

  const mutate = async (file, mutator, guarded) => {
    const before = clone(frontmatters.get(file.path) || {});
    const next = clone(before);
    const decision = mutator(next);
    if (guardedHook) {
      const forced = guardedHook({ file, before, next, decision, guarded });
      if (forced) return forced;
    }
    if (guarded && decision === false) return 'guarded-abort';
    if (guarded && decision === 'unchanged') return 'unchanged';
    const changed = JSON.stringify(before) !== JSON.stringify(next);
    if (changed) {
      frontmatters.set(file.path, next);
      contents.set(file.path, serializeFrontmatter(next, String(contents.get(file.path) || '').split(/\n---\n/).slice(1).join('\n---\n')));
    }
    return changed ? 'changed' : 'unchanged';
  };

  const plugin = {
    manifest: { dir: '.obsidian/plugins/tps-global-context-menu' },
    settings: {
      enableRecurrence: true,
      promptOnRecurrenceEdit: false,
      recurrenceCompletionStatuses: ['complete', 'wont-do'],
      recurrenceDefaultStatus: 'open',
      recurringTemplateFolder: '',
      checkOpenChecklistItems: false,
      checkParentLinkStatuses: false,
      enableLogging: false,
      ...options.settings,
    },
    app: {
      internalPlugins: {},
      metadataCache: {
        getFileCache(file) {
          return { frontmatter: clone(options.cachedFrontmatters?.get(file.path) || frontmatters.get(file.path) || {}) };
        },
        fileToLinktext(file) { return file.basename; },
        getFirstLinkpathDest(target) {
          const normalized = String(target || '').replace(/\.md$/i, '');
          for (const file of files.values()) {
            if (file.path.replace(/\.md$/i, '') === normalized) return file;
          }
          for (const file of files.values()) {
            if (file.basename === normalized.split('/').pop()) return file;
          }
          return null;
        },
      },
      vault: {
        configDir: '.obsidian',
        adapter: {
          async exists(path) { return files.has(path) || folders.has(path) || (path.endsWith('recurrence-create-state.json') && stateContent != null); },
          async read(path) {
            if (path.endsWith('recurrence-create-state.json') && stateContent != null) return stateContent;
            throw new Error(`missing adapter path: ${path}`);
          },
          async write(path, content) {
            stateWrites.push({ path, content });
            if (rejectStateWrites || rejectNextStateWrite) {
              rejectNextStateWrite = false;
              throw new Error('adapter.write rejected');
            }
            stateContent = content;
          },
        },
        getAbstractFileByPath(path) { return files.get(path) || null; },
        getFileByPath(path) { return files.get(path) || null; },
        getMarkdownFiles() { return [...files.values()].filter((file) => file.extension === 'md'); },
        async createFolder(path) { folders.add(path); },
        async read(file) { return contents.get(file.path) || ''; },
        async cachedRead(file) { return contents.get(file.path) || ''; },
        async process(file, mutator) {
          const current = contents.get(file.path) || '';
          const next = mutator(current);
          if (typeof next !== 'string') throw new TypeError('Vault.process requires a synchronous string result');
          if (next !== current) contents.set(file.path, next);
          return next;
        },
        async create(path, content) {
          if (createError) throw createError;
          if (files.has(path)) throw new Error('path occupied');
          const file = addFile(path, parseFrontmatter(content));
          contents.set(path, content);
          return file;
        },
      },
    },
    frontmatterMutationService: {
      async process(file, mutator) {
        const before = clone(frontmatters.get(file.path) || {});
        const next = clone(before);
        mutator(next);
        if (processHook) {
          const forced = processHook({ file, before, next });
          if (forced) return false;
        }
        const changed = JSON.stringify(before) !== JSON.stringify(next);
        if (changed) {
          frontmatters.set(file.path, next);
          contents.set(file.path, serializeFrontmatter(next));
        }
        return changed;
      },
      async processWithOutcome(file, mutator) { return mutate(file, mutator, false); },
      async processGuardedWithOutcome(file, mutator) { return mutate(file, mutator, true); },
      async processGuarded(file, mutator) { return (await mutate(file, mutator, true)) === 'changed'; },
    },
    recurrenceService: { markFileAsModified() {} },
    eventService: { emitFilesUpdated(paths) { events.push(paths); } },
    persistentMenuManager: { refreshMenusForFile() {} },
    viewModeManager: { async handlePotentialFrontmatterChange() {} },
    canvasPropertiesService: { isCanvasFile: () => false },
    sharedServices: { status: { normalize: (value) => String(value ?? '').trim().toLowerCase() } },
  };

  const service = new BulkEditService(plugin);
  return {
    addFile,
    contents,
    events,
    files,
    frontmatters,
    plugin,
    service,
    stateWrites,
    getState: () => stateContent ? JSON.parse(stateContent) : null,
    setCreateError: (value) => { createError = value; },
    setGuardedHook: (value) => { guardedHook = value; },
    setProcessHook: (value) => { processHook = value; },
    setRejectStateWrites: (value) => { rejectStateWrites = value; },
    rejectNextStateWrite: () => { rejectNextStateWrite = true; },
  };
}

// The service's Symbol.hasInstance contract accepts these file-shaped objects.
globalThis.__RecurrenceTFile = class {
  constructor(path) {
    this.path = path;
    this.extension = path.split('.').pop();
    this.basename = path.split('/').pop().replace(/\.[^.]+$/, '');
    const slash = path.lastIndexOf('/');
    this.parent = { path: slash >= 0 ? path.slice(0, slash) : '' };
  }
};

test('structured recurrence outcomes distinguish readiness from an actual change', () => {
  const harness = createHarness();
  assert.deepEqual(harness.service.recurrenceMutationResult('changed'), { outcome: 'changed', ready: true, changed: true });
  assert.deepEqual(harness.service.recurrenceMutationResult('unchanged'), { outcome: 'unchanged', ready: true, changed: false });
  assert.deepEqual(harness.service.recurrenceMutationResult('write-refused'), { outcome: 'write-refused', ready: false, changed: false });
});

test('pre-transformed recurrence content is validated before create and a template clone loses its ownership marker', () => {
  const harness = createHarness();
  const template = harness.addFile('Templates/Series.md', { recurrenceTemplate: true, recurrenceRule: 'FREQ=DAILY' });
  const prepared = harness.service.prepareRecurrenceCreateContent(
    serializeFrontmatter({ recurrenceTemplate: true, recurrenceRule: 'FREQ=DAILY', completedDate: 'old' }, 'Body'),
    (frontmatter) => harness.service.initializeRecurrenceInstanceFrontmatter(frontmatter, {
      rule: 'FREQ=DAILY',
      scheduled: '2026-07-21 00:00:00',
      status: 'open',
      templateFile: template,
      instancePath: 'Events/Series 2026-07-21.md',
      seriesBaseName: 'Series',
    }),
  );
  assert.equal(prepared.outcome, 'changed');
  const frontmatter = parseFrontmatter(prepared.content);
  assert.equal(frontmatter.recurrenceTemplate, '[[Series]]');
  assert.notEqual(frontmatter.recurrenceTemplate, true);
  assert.equal(frontmatter.completedDate, undefined);

  const malformed = harness.service.prepareRecurrenceCreateContent('---\nstatus: open\n', () => undefined);
  assert.equal(malformed.outcome, 'parse-failed');
  assert.equal(malformed.content, undefined);
});

test('an unrelated template-path collision is refused byte-identically', async () => {
  const harness = createHarness({ settings: { recurringTemplateFolder: 'Templates' } });
  const sourceFile = harness.addFile('Events/Series 2026-07-20.md', {
    recurrenceRule: 'FREQ=DAILY',
    scheduled: '2026-07-20 00:00:00',
  }, 'Source body');
  const collision = harness.addFile('Templates/Series.md', { title: 'Unrelated note' }, 'Do not touch');
  const before = harness.contents.get(collision.path);

  const result = await harness.service.createOrUpdateRecurrenceTemplateFromInstance(
    sourceFile,
    clone(harness.frontmatters.get(sourceFile.path)),
    'FREQ=DAILY',
    null,
  );

  assert.equal(result, null);
  assert.equal(harness.contents.get(collision.path), before);
  assert.deepEqual(harness.frontmatters.get(collision.path), { title: 'Unrelated note' });
});

test('a committed template plus refused backlink is surfaced as a partial result, never all-success', async () => {
  const harness = createHarness({ settings: { recurringTemplateFolder: 'Templates' } });
  const sourceFile = harness.addFile('Events/Series 2026-07-20.md', {
    recurrenceRule: 'FREQ=DAILY',
    scheduled: '2026-07-20 00:00:00',
  });
  harness.setGuardedHook(({ file, next }) => (
    file.path === sourceFile.path && typeof next.recurrenceTemplate === 'string' ? 'write-refused' : null
  ));

  await harness.service.ensureRecurrenceTemplate([sourceFile]);

  assert.ok(harness.files.has('Templates/Series.md'));
  assert.equal(harness.frontmatters.get(sourceFile.path).recurrenceTemplate, undefined);
  assert.equal(globalThis.__recurrenceNotices.some((notice) => /Recurring series template created/.test(notice)), false);
  assert.equal(globalThis.__recurrenceLogs.some((row) => row[0] === 'warn' && row.some((value) => value?.partialCommit === true)), true);
});

test('live source state wins over stale metadata cache before recurrence creation', async () => {
  const cached = new Map();
  const harness = createHarness({ cachedFrontmatters: cached });
  const sourceFile = harness.addFile('Events/Tracker 2026-07-20.md', {
    recurrenceRule: 'FREQ=WEEKLY',
    scheduled: '2026-07-20 00:00:00',
  });
  const stale = { recurrenceRule: 'GCM-TRACKER', scheduled: '2026-07-20 00:00:00' };
  cached.set(sourceFile.path, stale);
  harness.service.shouldSkipNoteLevelRecurrence = async () => false;

  const result = await harness.service.createNextRecurrenceInstance(sourceFile, stale);

  assert.equal(result, false);
  assert.equal([...harness.files.keys()].filter((path) => path !== sourceFile.path).length, 0);
});

test('multi-file completion creates only for each file whose own mutation committed', async () => {
  const harness = createHarness();
  const first = harness.addFile('Events/A.md', { recurrenceRule: 'FREQ=DAILY', scheduled: '2026-07-20 00:00:00', status: 'open' });
  const second = harness.addFile('Events/B.md', { recurrenceRule: 'FREQ=DAILY', scheduled: '2026-07-20 00:00:00', status: 'open' });
  harness.setProcessHook(({ file }) => file.path === second.path ? 'write-refused' : null);
  harness.service.shouldSkipNoteLevelRecurrence = async () => false;
  const createdFor = [];
  harness.service.createNextRecurrenceInstance = async (file, live, expectation) => {
    createdFor.push({ file: file.path, status: live.status, expectation });
    return true;
  };

  const count = await harness.service.updateFrontmatter([first, second], { status: 'complete' });

  assert.equal(count, 1);
  assert.deepEqual(createdFor, [{ file: first.path, status: 'complete', expectation: { expectedStatus: 'complete' } }]);
  assert.equal(harness.frontmatters.get(second.path).status, 'open');
});

test('operation-state write rejection cannot claim acquisition or completion', async () => {
  const rejected = createHarness({ rejectStateWrites: true });
  const beginRejected = await rejected.service.beginRecurrenceOp('series|next', 'Events/Series next.md');
  assert.deepEqual(beginRejected, { status: 'unavailable' });
  assert.deepEqual(rejected.service.recurrenceOpState.ops, {});

  const harness = createHarness();
  const begin = await harness.service.beginRecurrenceOp('series|next', 'Events/Series next.md');
  assert.equal(begin.status, 'acquired');
  harness.rejectNextStateWrite();
  assert.equal(await harness.service.completeRecurrenceOp(begin.lease, 'Events/Series next.md'), false);
  assert.equal(harness.service.recurrenceOpState.ops['series|next'].state, 'creating');
  assert.equal(await harness.service.failRecurrenceOp(begin.lease), true);
  assert.deepEqual(harness.service.recurrenceOpState.ops, {});
});

test('tracker failure releases the exact acquired lease key', async () => {
  const harness = createHarness({ createError: new Error('create rejected') });
  const sourceFile = harness.addFile('Events/Tracker 2026-07-20.md', {
    recurrenceRule: 'GCM-TRACKER',
    status: 'complete',
  });
  harness.service.shouldSkipNoteLevelRecurrence = async () => false;

  const result = await harness.service.createNextRecurrenceInstance(
    sourceFile,
    clone(harness.frontmatters.get(sourceFile.path)),
    { expectedStatus: 'complete' },
  );

  assert.equal(result, false);
  assert.deepEqual(harness.service.recurrenceOpState.ops, {});
  assert.equal(harness.stateWrites.length, 2, 'one persisted acquire and one persisted exact-key release');
  assert.equal(harness.service.recurrenceCreationInProgress.has(sourceFile.path), false);
});

test('an existing recurrence target is not reported successful when the source marker write is refused', async () => {
  const harness = createHarness();
  const sourceFile = harness.addFile('Events/Tracker 2026-07-20.md', {
    recurrenceRule: 'GCM-TRACKER',
    recurrenceLastGenerated: 'GCM-TRACKER:Events/Tracker.md',
    status: 'complete',
  });
  harness.addFile('Events/Tracker.md', {
    recurrenceRule: 'GCM-TRACKER',
    status: 'open',
  });
  harness.service.shouldSkipNoteLevelRecurrence = async () => false;
  harness.setGuardedHook(({ file, decision }) => (
    file.path === sourceFile.path && decision === true ? 'guarded-abort' : null
  ));

  const result = await harness.service.createNextRecurrenceInstance(
    sourceFile,
    clone(harness.frontmatters.get(sourceFile.path)),
    { expectedStatus: 'complete' },
  );

  assert.equal(result, false);
  assert.equal(globalThis.__recurrenceNotices.some((notice) => /Created next tracker/.test(notice)), false);
});

test('an explicit invalid template link cannot fall back to a different configured template', async () => {
  const harness = createHarness({ settings: { recurringTemplateFolder: 'Templates' } });
  const sourceFile = harness.addFile('Events/Series 2026-07-20.md', {
    recurrenceRule: 'FREQ=DAILY',
    recurrenceTemplate: '[[Other/Series]]',
  });
  harness.addFile('Other/Series.md', { title: 'Same basename, but not the owned template' });
  harness.addFile('Templates/Series.md', { recurrenceTemplate: true, recurrenceRule: 'FREQ=DAILY' });

  const resolved = await harness.service.resolveValidatedRecurrenceTemplateFile(
    sourceFile,
    clone(harness.frontmatters.get(sourceFile.path)),
    'FREQ=DAILY',
  );

  assert.equal(resolved, null);
});

test('checkMissingRecurrences never adopts an unmarked file merely because it is in the template folder', async () => {
  const harness = createHarness({ settings: { recurringTemplateFolder: 'Templates' } });
  const unowned = harness.addFile('Templates/Legacy.md', { recurrenceRule: 'FREQ=DAILY' });
  harness.service.shouldSkipNoteLevelRecurrence = async () => false;
  harness.service.isConfiguredDailyNoteTemplate = async () => false;
  let bootstrapCalls = 0;
  harness.service.bootstrapTemplateInstanceFromToday = async () => { bootstrapCalls += 1; return true; };

  await harness.service.checkMissingRecurrences();

  assert.equal(bootstrapCalls, 0);
  assert.equal(harness.frontmatters.get(unowned.path).recurrenceTemplate, undefined);
});

test('removeFrontmatterKey treats an absent key as explicit unchanged and counts only a commit', async () => {
  const harness = createHarness();
  const absent = harness.addFile('Events/Absent.md', { status: 'open' });
  const present = harness.addFile('Events/Present.md', { status: 'open', obsolete: true });

  assert.equal(await harness.service.removeFrontmatterKey([absent], 'obsolete'), 0);
  assert.deepEqual(harness.frontmatters.get(absent.path), { status: 'open' });
  assert.equal(await harness.service.removeFrontmatterKey([present], 'obsolete'), 1);
  assert.equal(harness.frontmatters.get(present.path).obsolete, undefined);
});

test('BulkEdit delegates leading-frontmatter cleanup to the shared atomic normalizer', () => {
  assert.match(source, /normalizeLeadingWhitespaceBeforeFrontmatter as normalizeLeadingFrontmatter/);
  assert.match(source, /await normalizeLeadingFrontmatter\(this\.plugin\.app, file\);/);
  const method = source.slice(
    source.indexOf('private async normalizeLeadingWhitespaceBeforeFrontmatter'),
    source.indexOf('private findFrontmatterBlock'),
  );
  assert.doesNotMatch(method, /cachedRead|vault\.modify/);
});
