import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const settingsTabSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const parentLinkFormatSource = readFileSync(new URL('../src/handlers/parent-link-format.ts', import.meta.url), 'utf8');

async function importModule(relativePath) {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    external: ['obsidian'],
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

test('linked subitem mapping presentation fields survive textarea-style parse results', async () => {
  const { mergeLinkedSubitemMappingPresentation } = await importModule('../src/utils/linked-subitem-mapping.ts');

  const parsed = [
    { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete' },
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo' },
    { checkboxState: '[custom]', statuses: ['waiting'], toggleTargetStatus: 'todo' },
  ];
  const existing = [
    { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete', icon: 'square', label: 'Todo' },
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo', icon: 'check', label: 'Complete' },
  ];

  assert.deepEqual(mergeLinkedSubitemMappingPresentation(parsed, existing), [
    { checkboxState: '[ ]', statuses: ['todo'], toggleTargetStatus: 'complete', icon: 'square', label: 'Todo' },
    { checkboxState: '[x]', statuses: ['complete'], toggleTargetStatus: 'todo', icon: 'check', label: 'Complete' },
    { checkboxState: '[custom]', statuses: ['waiting'], toggleTargetStatus: 'todo', icon: undefined, label: undefined },
  ]);
});

test('parent link format and notebook navigator smart sort sanitize to one canonical shape', async () => {
  const { sanitizeNotebookNavigatorRuleSettings } = await importModule('../src/services/notebook-navigator-rule-settings.ts');

  assert.match(parentLinkFormatSource, /return value === 'markdown-title' \? 'markdown-title' : 'wikilink';/);
  assert.match(mainSource, /this\.settings\.parentLinkFormat = normalizeParentLinkFormat\(this\.settings\.parentLinkFormat\);/);
  assert.match(settingsTabSource, /\.setValue\(normalizeParentLinkFormat\(this\.plugin\.settings\.parentLinkFormat\)\)/);

  const sanitizedFromLegacyArray = sanitizeNotebookNavigatorRuleSettings({
    smartSort: [
      {
        id: 'bucket-a',
        enabled: true,
        name: 'By priority',
        match: 'all',
        conditions: [],
        sortCriteria: [{ source: 'frontmatter', field: 'priority', type: 'priority', direction: 'asc', mappings: [] }],
      },
    ],
  });
  assert.deepEqual(sanitizedFromLegacyArray.smartSort.buckets.map((bucket) => bucket.id), ['bucket-a']);

  const sanitizedFromLegacySegments = sanitizeNotebookNavigatorRuleSettings({
    smartSort: {
      segments: [
        {
          id: 'seg-1',
          enabled: true,
          source: 'frontmatter',
          field: 'status',
          fallback: '',
          mappings: [],
          match: 'all',
          conditions: [],
        },
      ],
    },
  });
  assert.equal(sanitizedFromLegacySegments.smartSort.buckets.length, 1);
  assert.equal(sanitizedFromLegacySegments.smartSort.buckets[0].id, 'seg-1');
  assert.equal(sanitizedFromLegacySegments.smartSort.buckets[0].sortCriteria[0].field, 'status');
});

test('icon and color rule filter matches exact case-insensitive working values deterministically', async () => {
  const { matchesRuleFilter, collectRuleFilterTerms } = await importModule('../src/notebook-navigator-settings/rule-filter.ts');

  const advancedRule = {
    id: 'rule-working',
    name: 'Status working',
    enabled: true,
    property: '',
    operator: 'is',
    value: '',
    pathPrefix: '',
    icon: 'lucide:clipboard-list',
    color: '#4caf50',
    match: 'all',
    conditions: [
      { source: 'frontmatter', field: 'status', operator: 'is', value: 'working' },
    ],
  };

  const terms = collectRuleFilterTerms(advancedRule, 1).map((term) => term.toLowerCase());
  assert.ok(terms.includes('working'));
  assert.equal(matchesRuleFilter(advancedRule, 1, 'working'), true);
  assert.equal(matchesRuleFilter(advancedRule, 1, 'Working'), true);
  assert.equal(matchesRuleFilter(advancedRule, 1, 'lucide:clipboard-list'), true);
  assert.equal(matchesRuleFilter(advancedRule, 1, 'nonexistent'), false);
});

test('recurrence and daily note child settings are hidden immediately when parent toggles turn off', () => {
  assert.match(settingsTabSource, /enableRecurrence = v; await this\.plugin\.saveSettings\(\); this\.display\(\);/);
  assert.match(settingsTabSource, /if \(this\.plugin\.settings\.enableDailyNoteNav\) \{/);
  assert.match(settingsTabSource, /enableDailyNoteNav = v;\s*await this\.plugin\.saveSettings\(\);\s*this\.display\(\);/);
});
