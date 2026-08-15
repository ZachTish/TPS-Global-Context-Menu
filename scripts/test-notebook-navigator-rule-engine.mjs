import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const serviceSource = readFileSync(
  new URL('../src/services/notebook-navigator-rule-service.ts', import.meta.url),
  'utf8',
);
const bucketSettingsSource = readFileSync(
  new URL('../src/notebook-navigator-settings/bucket-section.ts', import.meta.url),
  'utf8',
);
const ruleSettingsSource = readFileSync(
  new URL('../src/notebook-navigator-settings/rules-section.ts', import.meta.url),
  'utf8',
);
const registerEventsSource = readFileSync(
  new URL('../src/events/register-events.ts', import.meta.url),
  'utf8',
);

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
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
      name: 'obsidian-rule-test-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian-rule-test-stub',
          namespace: 'obsidian-rule-test-stub',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'obsidian-rule-test-stub' }, () => ({
          contents: `
            export class TFile {
              static [Symbol.hasInstance](value) {
                return Boolean(value && typeof value.path === 'string');
              }
            }
            export class TFolder {}
            export class Notice {}
            export function normalizePath(path) {
              return String(path || '').replace(/\\\\/gu, '/').replace(/\\/+/gu, '/');
            }
            export function setIcon() {}
            export const parseYaml = (value) => JSON.parse(String(value || '{}'));
            export const stringifyYaml = (value) => JSON.stringify(value);
            export function moment(value) {
              return globalThis.__ruleTestMoment(value);
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

const { RuleEngine } = await importBundled('../src/services/notebook-navigator-rule-engine.ts');
const { NotebookNavigatorRuleService } = await importBundled('../src/services/notebook-navigator-rule-service.ts');
const { sanitizeNotebookNavigatorRuleSettings } = await importBundled(
  '../src/services/notebook-navigator-rule-settings.ts',
);

const app = {
  plugins: { plugins: {} },
  internalPlugins: { plugins: {} },
};
const engine = new RuleEngine(app);

function context(frontmatter = {}, basename = 'Alpha') {
  return {
    file: {
      path: `Notes/${basename}.md`,
      name: `${basename}.md`,
      basename,
      extension: 'md',
      stat: {
        ctime: 1_720_000_000_000,
        mtime: 1_730_000_000_000,
      },
    },
    frontmatter,
    tags: [],
    body: '',
  };
}

function rule(id, icon, color, conditions) {
  return {
    id,
    name: id,
    enabled: true,
    property: '',
    operator: 'is',
    value: '',
    pathPrefix: '',
    icon,
    color,
    match: 'all',
    conditions,
  };
}

function bucket(id, condition, enabled = true) {
  return {
    id,
    name: id,
    enabled,
    match: 'all',
    conditions: [condition],
    sortCriteria: [],
  };
}

const dailyCondition = {
  source: 'frontmatter',
  field: 'kind',
  operator: 'is',
  value: 'dailynote',
};
const markdownCatchAll = {
  source: 'extension',
  field: '',
  operator: 'is',
  value: 'md',
};

test('icon rules use the first nonblank matching output and preserve a bottom catch-all', () => {
  const rules = [
    rule('daily-note', 'lucide:calendar', '', [dailyCondition]),
    rule('catch-all', 'lucide:file-text', '#777777', [markdownCatchAll]),
  ];

  const outputs = engine.resolveVisualOutputs(rules, context({ kind: 'dailynote' }, '2026-07-28'));
  assert.deepEqual(outputs.icon, {
    matched: true,
    value: 'lucide:calendar',
    ruleId: 'daily-note',
  });
  assert.deepEqual(
    outputs.color,
    { matched: true, value: '#777777', ruleId: 'catch-all' },
    'icon and color keep independent first-winner precedence',
  );

  const repeated = engine.resolveVisualOutputs(rules, context({ kind: 'dailynote' }, '2026-07-28'));
  assert.deepEqual(repeated, outputs, 'repeat evaluation must not retain later-rule state');
});

test('blank, disabled, and reordered icon rules have explicit deterministic precedence', () => {
  const blankFirst = rule('blank-first', '', '#111111', [markdownCatchAll]);
  const disabled = { ...rule('disabled', 'lucide:ban', '#222222', [markdownCatchAll]), enabled: false };
  const daily = rule('daily-note', 'lucide:calendar', '#333333', [dailyCondition]);
  const catchAll = rule('catch-all', 'lucide:file-text', '#444444', [markdownCatchAll]);

  const outputs = engine.resolveVisualOutputs(
    [blankFirst, disabled, daily, catchAll],
    context({ kind: 'dailynote' }),
  );
  assert.equal(outputs.icon.ruleId, 'daily-note', 'blank and disabled earlier rules cannot capture icon precedence');
  assert.equal(outputs.color.ruleId, 'blank-first', 'a nonblank output still wins independently');

  const reordered = engine.resolveVisualOutputs(
    [catchAll, daily],
    context({ kind: 'dailynote' }),
  );
  assert.equal(reordered.icon.ruleId, 'catch-all', 'moving the catch-all first intentionally makes it win');
});

test('sort keys use enabled bucket order and keep unmatched notes after every matched category', () => {
  const settings = {
    enabled: true,
    field: 'sort',
    separator: '_',
    appendBasename: true,
    relationshipGrouping: 'none',
    clearWhenNoMatch: true,
    buckets: [
      bucket('disabled', markdownCatchAll, false),
      bucket('working', {
        source: 'frontmatter',
        field: 'status',
        operator: 'is',
        value: 'working',
      }),
      bucket('holding', {
        source: 'frontmatter',
        field: 'status',
        operator: 'is',
        value: 'holding',
      }),
    ],
  };

  const working = engine.composeSortKeyResult(settings, context({ status: 'working' }, 'Work'));
  const holding = engine.composeSortKeyResult(settings, context({ status: 'holding' }, 'Hold'));
  const unmatched = engine.composeSortKeyResult(settings, context({ status: 'todo' }, 'Todo'));

  assert.deepEqual(
    { key: working.key, matched: working.matched, index: working.bucketIndex },
    { key: '000_Work', matched: true, index: 0 },
  );
  assert.deepEqual(
    { key: holding.key, matched: holding.matched, index: holding.bucketIndex },
    { key: '001_Hold', matched: true, index: 1 },
  );
  assert.deepEqual(
    { key: unmatched.key, matched: unmatched.matched, index: unmatched.bucketIndex },
    { key: '002_Todo', matched: false, index: null },
  );
  assert.ok(working.key < holding.key);
  assert.ok(holding.key < unmatched.key);
});

test('sort writer preserves the unmatched fallback even with the legacy clear toggle', () => {
  const service = new NotebookNavigatorRuleService({ app });
  const enabledSettings = {
    smartSort: {
      enabled: true,
      clearWhenNoMatch: true,
      buckets: [{ enabled: true }],
    },
  };
  const fallback = service.computeSortKey(
    {
      composeSortKeyResult: () => ({
        key: '001_Unmatched',
        matched: false,
        bucketIndex: null,
        bucketName: null,
      }),
    },
    enabledSettings,
    context(),
  );
  assert.equal(fallback, '001_Unmatched');

  const noEnabledBuckets = service.computeSortKey(
    { composeSortKeyResult: () => ({ key: '', matched: false }) },
    { smartSort: { ...enabledSettings.smartSort, buckets: [{ enabled: false }] } },
    context(),
  );
  assert.equal(noEnabledBuckets, null, 'the legacy clear toggle remains meaningful only with no enabled buckets');
});

test('note-open visual rules run locally without taking controller-owned sort and hide writes', () => {
  const fileOpenGate = sourceBlock(
    registerEventsSource,
    "plugin.app.workspace.on('file-open'",
    '// ── Reactive completedDate sync',
  );
  const applyBlock = sourceBlock(
    serviceSource,
    'async applyRulesToFile(',
    'markUserEdited(',
  );

  assert.match(fileOpenGate, /shouldAutoApplyOnFileOpen\(\)/u);
  assert.doesNotMatch(
    fileOpenGate.match(/if \(file instanceof TFile\)[\s\S]*?scheduleApply\(file,[\s\S]*?\}\);/u)?.[0] || '',
    /canRunBackgroundAutomation/u,
  );
  assert.match(serviceSource, /options\.reason === 'file-open'\s*\? 75/u);
  assert.match(serviceSource, /requiresControllerAutomation\(options\.reason\)/u);
  assert.match(serviceSource, /reason !== 'file-open'/u);
  assert.match(applyBlock, /if \(options\.reason !== 'file-open'\) \{[\s\S]*computeSortKey[\s\S]*applyHideTagMutations/u);
  assert.match(applyBlock, /applyScalarMutation\(frontmatter, iconField/u);
  assert.match(applyBlock, /applyScalarMutation\(frontmatter, colorField/u);
  assert.match(applyBlock, /kind:\s*'automation'[\s\S]{0,160}surface:\s*'notebook-navigator-rules'/u);
});

test('zero enabled buckets produce no synthetic sort key', () => {
  const result = engine.composeSortKeyResult({
    enabled: true,
    field: 'sort',
    separator: '_',
    appendBasename: true,
    relationshipGrouping: 'none',
    clearWhenNoMatch: false,
    buckets: [bucket('disabled', markdownCatchAll, false)],
  }, context());

  assert.deepEqual(result, {
    key: '',
    matched: false,
    bucketIndex: null,
    bucketName: null,
  });
});

test('created and modified rule sources read the file stat without throwing', () => {
  globalThis.window = {
    moment(value) {
      return { format: () => `timestamp:${value}` };
    },
  };
  const fileContext = context();

  assert.deepEqual(
    engine.getValuesForConditionSource('date-created', fileContext, ''),
    [`timestamp:${fileContext.file.stat.ctime}`],
  );
  assert.deepEqual(
    engine.getValuesForConditionSource('date-modified', fileContext, ''),
    [`timestamp:${fileContext.file.stat.mtime}`],
  );
  const missingStat = structuredClone(fileContext);
  delete missingStat.file.stat;
  assert.deepEqual(engine.getValuesForConditionSource('date-created', missingStat, ''), []);
});

test('sort condition groups survive settings sanitization', () => {
  const sanitized = sanitizeNotebookNavigatorRuleSettings({
    smartSort: {
      buckets: [{
        id: 'grouped',
        enabled: true,
        name: 'Grouped',
        match: 'any',
        conditions: [],
        conditionGroups: [{
          id: 'group-a',
          match: 'all',
          conditions: [
            { source: 'frontmatter', field: 'kind', operator: 'is', value: 'project' },
            { source: 'tag', field: '', operator: 'contains', value: 'active' },
          ],
        }],
        sortCriteria: [],
      }],
    },
  });

  assert.deepEqual(sanitized.smartSort.buckets[0].conditionGroups, [{
    id: 'group-a',
    match: 'all',
    conditions: [
      { source: 'frontmatter', field: 'kind', operator: 'is', value: 'project' },
      { source: 'tag', field: '', operator: 'contains', value: 'active' },
    ],
  }]);
});

test('settings expose repair actions and reconcile structural ordering changes once', () => {
  assert.match(bucketSettingsSource, /"Apply all notes"[\s\S]*?applyRulesToAllFiles\(true\)/u);
  assert.match(bucketSettingsSource, /"Move up"[\s\S]*?applyRulesToAllFiles\(true\)/u);
  assert.match(bucketSettingsSource, /"Move down"[\s\S]*?applyRulesToAllFiles\(true\)/u);
  assert.match(ruleSettingsSource, /"Move up"[\s\S]*?applyRulesToAllFiles\(true\)/u);
  assert.match(ruleSettingsSource, /"Move down"[\s\S]*?applyRulesToAllFiles\(true\)/u);
  assert.match(ruleSettingsSource, /activePreview\?\.iconRuleId === rule\.id/u);
  assert.match(serviceSource, /ctime:\s*file\.stat\.ctime/u);
  assert.match(serviceSource, /mtime:\s*file\.stat\.mtime/u);
  assert.doesNotMatch(
    serviceSource,
    /!sortResult\.matched && smartSort\.clearWhenNoMatch/u,
    'legacy clear behavior must not delete a valid unmatched fallback',
  );
});

test('adding or duplicating a bucket does not sweep the vault before configuration', () => {
  const addBlock = sourceBlock(
    bucketSettingsSource,
    'this.createActionButton(toolbar, "+ Add bucket"',
    'this.createActionButton(toolbar, "Apply active note"',
  );
  const duplicateBlock = sourceBlock(
    bucketSettingsSource,
    '.setTitle("Duplicate")',
    'menu.addSeparator();',
  );

  assert.doesNotMatch(addBlock, /applyRulesToAllFiles/u);
  assert.doesNotMatch(duplicateBlock, /applyRulesToAllFiles/u);
});
