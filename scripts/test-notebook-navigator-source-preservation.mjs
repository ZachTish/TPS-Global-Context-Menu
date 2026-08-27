import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

function parseScalar(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/gu, "'");
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:\d{2})$/u.test(value)) {
    return new Date(value);
  }
  return value;
}

function parseYamlForTest(source) {
  const result = {};
  let listKey = null;
  for (const line of String(source || '').replace(/\r\n/gu, '\n').split('\n')) {
    const list = line.match(/^\s+-\s+(.*)$/u);
    if (list && listKey) {
      result[listKey].push(parseScalar(list[1]));
      continue;
    }
    const pair = line.match(/^([^#\s][^:]*):(?:\s*(.*))?$/u);
    if (!pair) continue;
    const key = pair[1].trim().replace(/^['"]|['"]$/gu, '');
    const rawValue = pair[2] ?? '';
    if (!rawValue.trim()) {
      result[key] = [];
      listKey = key;
    } else {
      result[key] = parseScalar(rawValue);
      listKey = null;
    }
  }
  return result;
}

function yamlScalarForTest(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (value == null) return 'null';
  const text = String(value);
  return !text || /^[-?:,\[\]{}#&*!|>'"%@`]|[:#]\s|\s$/u.test(text)
    ? JSON.stringify(text)
    : text;
}

function stringifyYamlForTest(record) {
  const output = [];
  for (const [key, value] of Object.entries(record || {})) {
    if (Array.isArray(value)) {
      output.push(`${key}:`);
      for (const entry of value) output.push(`  - ${yamlScalarForTest(entry)}`);
    } else {
      output.push(`${key}: ${yamlScalarForTest(value)}`);
    }
  }
  return `${output.join('\n')}\n`;
}

async function importBundled(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-source-preservation-test-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian-source-preservation-test-stub',
          namespace: 'obsidian-source-preservation-test-stub',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'obsidian-source-preservation-test-stub' }, () => ({
          contents: `
            export class TFile {
              static [Symbol.hasInstance](value) {
                return Boolean(value && typeof value.path === 'string');
              }
            }
            export class TFolder {}
            export class MarkdownView {}
            export class WorkspaceLeaf {}
            export class Notice {}
            export function normalizePath(path) {
              return String(path || '').replace(/\\\\/gu, '/').replace(/\\/+/gu, '/');
            }
            export function setIcon() {}
            export const parseYaml = globalThis.__parseYamlForSourcePreservationTest;
            export const stringifyYaml = globalThis.__stringifyYamlForSourcePreservationTest;
            export function moment(value) {
              return globalThis.__sourcePreservationMoment(value);
            }
            moment.ISO_8601 = 'ISO_8601';
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

globalThis.__parseYamlForSourcePreservationTest = parseYamlForTest;
globalThis.__stringifyYamlForSourcePreservationTest = stringifyYamlForTest;
globalThis.__sourcePreservationMoment = () => ({
  isValid: () => false,
  format: () => '',
});
globalThis.window = {
  setTimeout,
  clearTimeout,
  moment: globalThis.__sourcePreservationMoment,
};

const { FrontmatterMutationService } = await importBundled('../src/services/frontmatter-mutation-service.ts');
const { NotebookNavigatorRuleService } = await importBundled('../src/services/notebook-navigator-rule-service.ts');
const { NativeRecordService, parseNativeRecordDocument } = await importBundled('../src/services/native-record-service.ts');

const pocRecord = [
  '\uFEFF---\r\n',
  'eventTitle: "Daily Standup: Platform"\r\n',
  '# producer-owned event fields stay in authored order\r\n',
  'status: confirmed\r\n',
  'createdDate: 2026-08-25T18:12:13.456Z\r\n',
  'scheduled: 2026-09-01T14:30:00Z\r\n',
  'due: 2026-09-01T10:15:00-05:00\r\n',
  'eventDate: 2026-09-01\r\n',
  'allDay: false\r\n',
  'calendarId: calendar-source-preservation-fixture\r\n',
  'calendarOccurrenceId: uid-77-20260901T093000\r\n',
  'tags:\r\n',
  '  - calendar-event\r\n',
  '  - work\r\n',
  '  - tps/record/v1/calendar-event/calendar-3rv0kr\r\n',
  'kind: calendar-event\r\n',
  'title: "[[Calendar Events/2026-09-01/Calendar event--calendar-3rv0kr|Daily Standup: Platform]]"\r\n',
  'modifiedDate: 2026-08-25T18:12:15.789Z\r\n',
  '---\r\n',
  'Human note with --- and scheduled: text.\r\n',
].join('');

function makeFixture(initialContent = pocRecord) {
  let content = initialContent;
  let activeProcesses = 0;
  let maxActiveProcesses = 0;
  const updates = [];
  const indexed = [];
  const file = {
    path: 'calendar-event:work:uid-77:2026-09-01T14:30:00Z.md',
    name: 'calendar-event:work:uid-77:2026-09-01T14:30:00Z.md',
    basename: 'calendar-event:work:uid-77:2026-09-01T14:30:00Z',
    extension: 'md',
    stat: { ctime: 1_777_777_777_000, mtime: 1_777_777_777_000 },
  };
  const plugin = {
    manifest: { id: 'tps-global-context-menu' },
    settings: {
      dataArchitectureMode: 'native-records',
      nativeRecordIdentityMode: 'tag',
      nativeRecordLayout: 'flat-root',
      nativeRecordRootPath: '/',
      properties: [],
      enableActivityLog: false,
      enableAutoRename: false,
      notebookNavigatorRules: {
        enabled: true,
        frontmatterWriteExclusions: '',
        clearIconWhenNoMatch: false,
        clearColorWhenNoMatch: false,
        autoRemoveHiddenWhenNoMatch: true,
        rules: [{
          id: 'calendar-event',
          name: 'Calendar event',
          enabled: true,
          icon: 'calendar-clock',
          color: '#3b82f6',
          match: 'all',
          conditions: [{ source: 'tag', field: '', operator: 'contains', value: 'calendar-event' }],
        }],
        hideRules: [],
        smartSort: {
          enabled: true,
          field: 'sort',
          separator: '_',
          appendBasename: true,
          relationshipGrouping: 'none',
          clearWhenNoMatch: false,
          buckets: [{
            id: 'markdown',
            name: 'Markdown',
            enabled: true,
            match: 'all',
            conditions: [{ source: 'extension', field: '', operator: 'is', value: 'md' }],
            sortCriteria: [],
          }],
        },
      },
    },
    app: {
      vault: {
        cachedRead: async () => content,
        process: async (_file, updater) => {
          activeProcesses += 1;
          maxActiveProcesses = Math.max(maxActiveProcesses, activeProcesses);
          await new Promise((resolve) => setTimeout(resolve, 2));
          content = updater(content);
          await new Promise((resolve) => setTimeout(resolve, 2));
          activeProcesses -= 1;
          return content;
        },
        getFileByPath: () => file,
      },
      metadataCache: {
        getFileCache: () => ({ tags: [] }),
      },
      workspace: {
        getActiveFile: () => null,
        getLeavesOfType: () => [],
        activeLeaf: null,
      },
      plugins: { plugins: {} },
      internalPlugins: { plugins: {} },
    },
    filePropertiesService: {
      isCompanionFile: () => false,
      isPropertyTarget: () => false,
      hasCompanion: () => false,
    },
    eventService: {
      emitFilesUpdated: (...args) => updates.push(args),
      emitExplicitAction: () => {},
    },
    entityIndexService: {
      upsertFile: (...args) => indexed.push(args),
    },
    parentLinkResolutionService: {
      getParentsForChild: () => [],
    },
    sharedServices: {},
    canRunBackgroundAutomation: () => true,
  };
  plugin.frontmatterMutationService = new FrontmatterMutationService(plugin);
  plugin.nativeRecordService = new NativeRecordService(plugin);
  return {
    file,
    plugin,
    getContent: () => content,
    getMaxActiveProcesses: () => maxActiveProcesses,
    updates,
    indexed,
  };
}

function stripManagedLines(source) {
  return source.replace(/^(?:icon|color|sort):[^\r\n]*(?:\r?\n)/gmu, '');
}

function stripNativeUpdateLines(source) {
  return source
    .replace(/^(?:title|modifiedDate|tpsId|tpsSchemaVersion):[^\r\n]*(?:\r?\n)/gmu, '')
    .replace(/^  - tps\/record\/v1\/calendar-event\/calendar-3rv0kr(?:\r?\n)/gmu, '');
}

test('Notebook Navigator visual rules preserve POC native-record YAML and body source', async () => {
  const fixture = makeFixture();
  const service = new NotebookNavigatorRuleService(fixture.plugin);
  const mutationService = fixture.plugin.frontmatterMutationService;
  const originalWriter = mutationService.processOwnedKeysPreservingSource.bind(mutationService);
  let ownedKeys = [];
  mutationService.processOwnedKeysPreservingSource = async (file, keys, mutator, cause) => {
    ownedKeys = [...keys];
    return originalWriter(file, keys, mutator, cause);
  };

  const changed = await service.applyRulesToFile(fixture.file, {
    reason: 'gcm-manual-all',
    force: true,
    bypassCreationGrace: true,
  });

  const output = fixture.getContent();
  assert.equal(changed, true);
  assert.deepEqual(new Set(ownedKeys), new Set(['icon', 'color', 'sort']));
  assert.equal(stripManagedLines(output), pocRecord);
  assert.match(output, /^icon: calendar-clock\r$/mu);
  assert.match(output, /^color: "#3b82f6"\r$/mu);
  assert.match(output, /^sort: /mu);
  assert.match(output, /^scheduled: 2026-09-01T14:30:00Z\r$/mu);
  assert.match(output, /^due: 2026-09-01T10:15:00-05:00\r$/mu);
  assert.match(output, /^eventDate: 2026-09-01\r$/mu);
  assert.match(output, /^  - calendar-event\r$/mu);
  assert.ok(output.endsWith('Human note with --- and scheduled: text.\r\n'));
  assert.equal(fixture.updates.length, 1);
  assert.equal(fixture.indexed.length, 1);

  const parsedRecord = parseNativeRecordDocument(output);
  assert.ok(parsedRecord, 'the post-mutation Markdown must remain parseable as a native record document');
  const inspection = new NativeRecordService(fixture.plugin).inspect(parsedRecord.frontmatter);
  assert.equal(inspection?.id, 'calendar-3rv0kr');
  assert.equal(inspection?.kind, 'calendar-event');
});

test('native architecture retains blank-title cleanup and hide-tag automation for ordinary Markdown notes', async () => {
  const source = [
    '---\r\n',
    'title: Ordinary Note\r\n',
    '# producer comment stays put\r\n',
    'tags:\r\n',
    '  - keep\r\n',
    'producerTimestamp: 2026-08-25T18:12:13.456Z\r\n',
    '---\r\n',
  ].join('');
  const fixture = makeFixture(source);
  Object.assign(fixture.file, {
    path: 'Ordinary Note.md',
    name: 'Ordinary Note.md',
    basename: 'Ordinary Note',
  });
  fixture.plugin.settings.notebookNavigatorRules.hideRules = [{
    id: 'hide-ordinary-note',
    name: 'Hide ordinary note',
    enabled: true,
    tagName: 'hidden',
    mode: 'add',
    match: 'all',
    conditions: [{ source: 'tag', field: '', operator: 'contains', value: 'keep' }],
  }];

  const changed = await new NotebookNavigatorRuleService(fixture.plugin).applyRulesToFile(fixture.file, {
    reason: 'create',
    force: true,
    bypassCreationGrace: true,
  });

  const expectedWithoutSort = source
    .replace('title: Ordinary Note\r\n', '')
    .replace('tags:\r\n  - keep\r\n', 'tags:\r\n  - keep\r\n  - hidden\r\n');
  const output = fixture.getContent();
  assert.equal(changed, true);
  assert.equal(stripManagedLines(output), expectedWithoutSort);
  assert.doesNotMatch(output, /^title:/mu);
  assert.match(output, /^  - keep\r$/mu);
  assert.match(output, /^  - hidden\r$/mu);
  assert.match(output, /^producerTimestamp: 2026-08-25T18:12:13\.456Z\r$/mu);
});

test('native architecture protects proven native-record title and tags from Notebook Navigator automation', async () => {
  const source = [
    '\uFEFF---\r\n',
    'tags:\r\n',
    '  - keep\r\n',
    '  - tps/record/v1/task/native-protected\r\n',
    'kind: task\r\n',
    'title: Native Protected\r\n',
    'createdDate: 2026-08-25T18:12:13.456Z\r\n',
    'modifiedDate: 2026-08-25T18:12:15.789Z\r\n',
    '---\r\n',
  ].join('');
  const fixture = makeFixture(source);
  Object.assign(fixture.file, {
    path: 'Native Protected.md',
    name: 'Native Protected.md',
    basename: 'Native Protected',
  });
  fixture.plugin.settings.notebookNavigatorRules.hideRules = [{
    id: 'hide-native-record',
    name: 'Hide native record',
    enabled: true,
    tagName: 'hidden',
    mode: 'add',
    match: 'all',
    conditions: [{ source: 'tag', field: '', operator: 'contains', value: 'keep' }],
  }];

  const changed = await new NotebookNavigatorRuleService(fixture.plugin).applyRulesToFile(fixture.file, {
    reason: 'create',
    force: true,
    bypassCreationGrace: true,
  });

  const output = fixture.getContent();
  assert.equal(changed, true, 'the owned smart-sort field still updates');
  assert.equal(stripManagedLines(output), source);
  assert.match(output, /^title: Native Protected\r$/mu);
  assert.match(output, /^  - keep\r$/mu);
  assert.match(output, /^  - tps\/record\/v1\/task\/native-protected\r$/mu);
  assert.doesNotMatch(output, /^  - hidden\r$/mu);
});

test('legacy architecture still protects a proven native record from Notebook Navigator automation', async () => {
  const source = [
    '\uFEFF---\r\n',
    'tpsId: legacy-mode-protected\r\n',
    'tpsSchemaVersion: 1\r\n',
    'kind: task\r\n',
    'title: Legacy Mode Protected\r\n',
    'createdDate: 2026-08-25T18:12:13.456Z\r\n',
    'modifiedDate: 2026-08-25T18:12:15.789Z\r\n',
    'tags:\r\n',
    '  - keep\r\n',
    '---\r\n',
  ].join('');
  const fixture = makeFixture(source);
  Object.assign(fixture.file, {
    path: 'Legacy Mode Protected.md',
    name: 'Legacy Mode Protected.md',
    basename: 'Legacy Mode Protected',
  });
  Object.assign(fixture.plugin.settings, {
    dataArchitectureMode: 'legacy',
    nativeRecordIdentityMode: 'property',
    nativeRecordStorageAliases: [],
  });
  Object.assign(fixture.plugin.settings.notebookNavigatorRules, {
    frontmatterIconField: 'TPSID',
    frontmatterColorField: 'TaGs',
    hideRules: [{
      id: 'hide-legacy-mode-record',
      name: 'Hide legacy-mode record',
      enabled: true,
      tagName: 'hidden',
      mode: 'add',
      match: 'all',
      conditions: [{ source: 'tag', field: '', operator: 'contains', value: 'keep' }],
    }],
    smartSort: {
      ...fixture.plugin.settings.notebookNavigatorRules.smartSort,
      enabled: true,
      field: 'TiTlE',
    },
  });

  const parsed = parseNativeRecordDocument(source);
  assert.ok(parsed, 'fixture parses');
  assert.ok(
    fixture.plugin.nativeRecordService.inspect(parsed.frontmatter),
    'record identity remains provable while global architecture is Legacy',
  );

  const changed = await new NotebookNavigatorRuleService(fixture.plugin).applyRulesToFile(fixture.file, {
    reason: 'create',
    force: true,
    bypassCreationGrace: true,
  });

  assert.equal(changed, false);
  assert.equal(fixture.getContent(), source);
  assert.equal(fixture.updates.length, 0);
  assert.equal(fixture.indexed.length, 0);
});

test('proven native records reject Notebook Navigator destinations owned by current and readable storage profiles', async () => {
  const cases = [
    {
      label: 'canonical envelope and tags',
      fileName: 'Canonical Protected.md',
      source: [
        '\uFEFF---\r\n',
        'tpsId: canonical-protected\r\n',
        'tpsSchemaVersion: 1\r\n',
        'kind: task\r\n',
        'title: Canonical Protected\r\n',
        'createdDate: 2026-08-25T18:12:13.456Z\r\n',
        'modifiedDate: 2026-08-25T18:12:15.789Z\r\n',
        'tags:\r\n',
        '  - keep\r\n',
        '---\r\n',
      ].join(''),
      settings: { nativeRecordIdentityMode: 'property', nativeRecordStorageAliases: [] },
      iconField: 'TPSID',
      colorField: 'TaGs',
      sortField: 'TiTlE',
    },
    {
      label: 'custom current writer profile',
      fileName: 'Current Custom Protected.md',
      source: [
        '\uFEFF---\r\n',
        'currentId: current-custom-protected\r\n',
        'currentSchema: 1\r\n',
        'currentKind: task\r\n',
        'currentTitle: Current Custom Protected\r\n',
        'currentCreated: 2026-08-25T18:12:13.456Z\r\n',
        'currentModified: 2026-08-25T18:12:15.789Z\r\n',
        'tags:\r\n',
        '  - keep\r\n',
        '---\r\n',
      ].join(''),
      settings: {
        nativeRecordIdentityMode: 'property',
        nativeRecordIdentityPropertyKey: 'currentId',
        nativeRecordSchemaPropertyKey: 'currentSchema',
        nativeRecordKindPropertyKey: 'currentKind',
        nativeRecordTitlePropertyKey: 'currentTitle',
        nativeRecordCreatedPropertyKey: 'currentCreated',
        nativeRecordModifiedPropertyKey: 'currentModified',
        nativeRecordStorageAliases: [],
      },
      iconField: 'currentId',
      colorField: 'currentKind',
      sortField: 'currentTitle',
    },
    {
      label: 'custom readable legacy profile',
      fileName: 'Legacy Custom Protected.md',
      source: [
        '\uFEFF---\r\n',
        'legacyId: legacy-custom-protected\r\n',
        'legacySchema: 1\r\n',
        'legacyKind: task\r\n',
        'legacyTitle: Legacy Custom Protected\r\n',
        'legacyCreated: 2026-08-25T18:12:13.456Z\r\n',
        'legacyModified: 2026-08-25T18:12:15.789Z\r\n',
        'tags:\r\n',
        '  - keep\r\n',
        '---\r\n',
      ].join(''),
      settings: {
        nativeRecordIdentityMode: 'property',
        nativeRecordStorageAliases: [{
          identityMode: 'property',
          identityPropertyKey: 'legacyId',
          schemaPropertyKey: 'legacySchema',
          identityTagPrefix: 'legacy/custom',
          kindPropertyKey: 'legacyKind',
          titlePropertyKey: 'legacyTitle',
          createdPropertyKey: 'legacyCreated',
          modifiedPropertyKey: 'legacyModified',
        }],
      },
      iconField: 'legacyId',
      colorField: 'legacyCreated',
      sortField: 'legacyTitle',
    },
  ];

  for (const testCase of cases) {
    const fixture = makeFixture(testCase.source);
    const basename = testCase.fileName.replace(/\.md$/u, '');
    Object.assign(fixture.file, {
      path: testCase.fileName,
      name: testCase.fileName,
      basename,
    });
    Object.assign(fixture.plugin.settings, testCase.settings);
    Object.assign(fixture.plugin.settings.notebookNavigatorRules, {
      frontmatterIconField: testCase.iconField,
      frontmatterColorField: testCase.colorField,
      rules: [{
        id: `collision-${testCase.label}`,
        name: testCase.label,
        enabled: true,
        icon: 'shield-check',
        color: '#ef4444',
        match: 'all',
        conditions: [{ source: 'extension', field: '', operator: 'is', value: 'md' }],
      }],
      hideRules: [],
      smartSort: {
        ...fixture.plugin.settings.notebookNavigatorRules.smartSort,
        enabled: true,
        field: testCase.sortField,
      },
    });

    const parsed = parseNativeRecordDocument(testCase.source);
    assert.ok(parsed, `${testCase.label}: fixture parses`);
    assert.ok(
      fixture.plugin.nativeRecordService.inspect(parsed.frontmatter),
      `${testCase.label}: fixture is a proven native record`,
    );

    const changed = await new NotebookNavigatorRuleService(fixture.plugin).applyRulesToFile(fixture.file, {
      reason: 'gcm-manual-all',
      force: true,
      bypassCreationGrace: true,
    });

    assert.equal(changed, false, `${testCase.label}: every configured destination is protected`);
    assert.equal(fixture.getContent(), testCase.source, `${testCase.label}: record bytes stay exact`);
    assert.equal(fixture.updates.length, 0, `${testCase.label}: no update event is emitted`);
    assert.equal(fixture.indexed.length, 0, `${testCase.label}: no speculative index update occurs`);
  }
});

test('nativeRecords.update migrates legacy identity through owned fields and preserves producer source', async () => {
  const fixture = makeFixture();
  const service = new NativeRecordService(fixture.plugin);
  const nextTitle = '[[Calendar Events/2026-09-01/Calendar event--calendar-3rv0kr|Daily Standup: Platform sync]]';

  const updated = await service.update(fixture.file, { title: nextTitle }, {
    kind: 'automation',
    sourcePluginId: 'tps-controller',
    surface: 'calendar-title-reconciliation',
  });

  const output = fixture.getContent();
  assert.equal(updated?.id, 'calendar-3rv0kr');
  assert.equal(updated?.kind, 'calendar-event');
  assert.equal(updated?.frontmatter.title, nextTitle);
  assert.equal(stripNativeUpdateLines(output), stripNativeUpdateLines(pocRecord));
  assert.doesNotMatch(output, /^  - tps\/record\/v1\/calendar-event\/calendar-3rv0kr\r$/mu);
  assert.match(output, /^tpsId: calendar-3rv0kr\r$/mu);
  assert.match(output, /^tpsSchemaVersion: 1\r$/mu);
  assert.match(output, /^  - calendar-event\r$/mu);
  assert.match(output, /^  - work\r$/mu);
  assert.match(output, /^title: "\[\[Calendar Events\/2026-09-01\/Calendar event--calendar-3rv0kr\|Daily Standup: Platform sync\]\]"\r$/mu);
  assert.match(output, /^modifiedDate: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\r$/mu);
  assert.match(output, /^createdDate: 2026-08-25T18:12:13\.456Z\r$/mu);
  assert.match(output, /^scheduled: 2026-09-01T14:30:00Z\r$/mu);
  assert.match(output, /^due: 2026-09-01T10:15:00-05:00\r$/mu);
  assert.ok(output.endsWith('Human note with --- and scheduled: text.\r\n'));
  assert.equal(fixture.updates.length, 1);
  assert.equal(fixture.indexed.length, 1);
});

test('source-preserving owned-key writes serialize concurrent rule updates per file', async () => {
  const fixture = makeFixture();
  const service = fixture.plugin.frontmatterMutationService;

  const [iconChanged, colorChanged] = await Promise.all([
    service.processOwnedKeysPreservingSource(fixture.file, ['icon'], (frontmatter) => {
      frontmatter.icon = 'calendar-days';
    }),
    service.processOwnedKeysPreservingSource(fixture.file, ['color'], (frontmatter) => {
      frontmatter.color = '#2563eb';
    }),
  ]);

  const output = fixture.getContent();
  assert.equal(iconChanged, true);
  assert.equal(colorChanged, true);
  assert.equal(fixture.getMaxActiveProcesses(), 1);
  assert.equal(stripManagedLines(output), pocRecord);
  assert.match(output, /^icon: calendar-days\r$/mu);
  assert.match(output, /^color: "#2563eb"\r$/mu);
  assert.equal(fixture.updates.length, 2);
});

test('source-preserving writes index the persisted document rather than unowned mutator changes', async () => {
  const source = [
    '---\n',
    'producerValue: keep\n',
    'icon: calendar\n',
    '---\n',
    'Body stays.\n',
  ].join('');
  const fixture = makeFixture(source);

  const changed = await fixture.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(
    fixture.file,
    ['icon'],
    (frontmatter) => {
      frontmatter.icon = 'calendar-days';
      frontmatter.producerValue = 'unpersisted-change';
      frontmatter.unownedGhost = 'must-not-be-indexed';
    },
  );

  assert.equal(changed, true);
  assert.equal(fixture.getContent(), source.replace('icon: calendar\n', 'icon: calendar-days\n'));
  assert.equal(fixture.indexed.length, 1);
  const indexedFrontmatter = fixture.indexed[0][1];
  assert.equal(indexedFrontmatter.icon, 'calendar-days');
  assert.equal(indexedFrontmatter.producerValue, 'keep');
  assert.equal(Object.hasOwn(indexedFrontmatter, 'unownedGhost'), false);
});

test('an unchanged owned value performs no write and preserves the complete document', async () => {
  const withIcon = pocRecord.replace('---\r\nHuman note', 'icon: calendar-days\r\n---\r\nHuman note');
  const fixture = makeFixture(withIcon);
  const before = fixture.getContent();

  const changed = await fixture.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(
    fixture.file,
    ['icon'],
    (frontmatter) => {
      frontmatter.icon = 'calendar-days';
    },
  );

  assert.equal(changed, false);
  assert.equal(fixture.getContent(), before);
  assert.equal(fixture.updates.length, 0);
});

test('source-preserving writes add frontmatter to plain LF Markdown without changing its body', async () => {
  const body = '# Plain note\n\nKeep this body byte-for-byte.\n';
  const fixture = makeFixture(body);

  const changed = await fixture.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(
    fixture.file,
    ['icon'],
    (frontmatter) => {
      frontmatter.icon = 'notebook';
    },
  );

  assert.equal(changed, true);
  assert.equal(fixture.getContent(), `---\nicon: notebook\n---\n${body}`);
});

test('source-preserving writes retain a YAML document-end closer', async () => {
  const source = '---\nscheduled: 2026-09-01T14:30:00Z\n...\nBody stays.\n';
  const fixture = makeFixture(source);

  const changed = await fixture.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(
    fixture.file,
    ['icon'],
    (frontmatter) => {
      frontmatter.icon = 'calendar-days';
    },
  );

  assert.equal(changed, true);
  assert.equal(fixture.getContent(), '---\nscheduled: 2026-09-01T14:30:00Z\nicon: calendar-days\n...\nBody stays.\n');
});

test('quoted managed keys and multiline/list managed values update or remove as one source span', async () => {
  const source = [
    '---\n',
    'scheduled: 2026-09-01T14:30:00Z\n',
    '"icon":\n',
    '  - legacy-one\n',
    '  - legacy-two\n',
    'color: |\n',
    '  an old\n',
    '\n',
    '  multiline value\n',
    '# keep this comment\n',
    'tags:\n',
    '  - tps/record/v1/calendar-event/calendar-3rv0kr\n',
    '---\n',
    'Body stays.\n',
  ].join('');
  const fixture = makeFixture(source);

  const changed = await fixture.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(
    fixture.file,
    ['icon', 'color'],
    (frontmatter) => {
      frontmatter.icon = 'calendar-clock';
      delete frontmatter.color;
    },
  );

  assert.equal(changed, true);
  assert.equal(fixture.getContent(), [
    '---\n',
    'scheduled: 2026-09-01T14:30:00Z\n',
    '"icon": calendar-clock\n',
    '# keep this comment\n',
    'tags:\n',
    '  - tps/record/v1/calendar-event/calendar-3rv0kr\n',
    '---\n',
    'Body stays.\n',
  ].join(''));
});

test('duplicate owned keys fail closed without deleting either ambiguous source field', async () => {
  const source = [
    '---\n',
    'icon: calendar\n',
    'Icon: alarm-clock\n',
    'scheduled: 2026-09-01T14:30:00Z\n',
    '---\n',
    'Body.\n',
  ].join('');
  const fixture = makeFixture(source);

  const changed = await fixture.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(
    fixture.file,
    ['icon'],
    (frontmatter) => {
      frontmatter.icon = 'calendar-days';
    },
  );

  assert.equal(changed, false);
  assert.equal(fixture.getContent(), source);
  assert.equal(fixture.updates.length, 0);
});

test('duplicate unrelated producer keys survive a managed visual-field insertion exactly', async () => {
  const source = [
    '---\n',
    'producerValue: first\n',
    'producerValue: second\n',
    'scheduled: 2026-09-01T14:30:00Z\n',
    '---\n',
    'Body.\n',
  ].join('');
  const fixture = makeFixture(source);

  const changed = await fixture.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(
    fixture.file,
    ['icon'],
    (frontmatter) => {
      frontmatter.icon = 'calendar-days';
    },
  );

  assert.equal(changed, true);
  assert.equal(stripManagedLines(fixture.getContent()), source);
  assert.equal(fixture.getContent().match(/^producerValue:/gmu)?.length, 2);
});

test('malformed or unclosed frontmatter is left unchanged', async () => {
  const source = '---\nscheduled: 2026-09-01T14:30:00Z\nBody without a closing delimiter.\n';
  const fixture = makeFixture(source);

  const changed = await fixture.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(
    fixture.file,
    ['icon'],
    (frontmatter) => {
      frontmatter.icon = 'calendar-days';
    },
  );

  assert.equal(changed, false);
  assert.equal(fixture.getContent(), source);
  assert.equal(fixture.updates.length, 0);
});

test('CR-only Markdown fails closed without creating duplicate frontmatter', async () => {
  const source = '---\rscheduled: 2026-09-01T14:30:00Z\r---\rBody stays.\r';
  const fixture = makeFixture(source);

  const changed = await fixture.plugin.frontmatterMutationService.processOwnedKeysPreservingSource(
    fixture.file,
    ['icon'],
    (frontmatter) => {
      frontmatter.icon = 'calendar-days';
    },
  );

  assert.equal(changed, false);
  assert.equal(fixture.getContent(), source);
  assert.equal(fixture.updates.length, 0);
  assert.equal(fixture.indexed.length, 0);
});
