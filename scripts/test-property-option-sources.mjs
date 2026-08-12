import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function importModule(relativePath, { stubObsidian = false } = {}) {
  const plugins = stubObsidian
    ? [{
        name: 'stub-obsidian',
        setup(build) {
          build.onResolve({ filter: /^obsidian$/ }, () => ({
            path: 'obsidian',
            namespace: 'test-stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'test-stub' }, () => ({
            contents: [
              'export class App {}',
              'export function getAllTags() { return []; }',
            ].join('\n'),
            loader: 'js',
          }));
        },
      }]
    : [];
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    plugins,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

async function importBulkEditService() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL('../src/services/bulk-edit-service.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'bulk-edit-obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian',
          namespace: 'bulk-edit-test',
        }));
        builder.onLoad({ filter: /.*/u, namespace: 'bulk-edit-test' }, () => ({
          contents: `
            class Dummy {
              constructor() {}
              open() {}
            }
            class TFile extends Dummy {}
            module.exports = new Proxy(
              {
                App: Dummy,
                Modal: Dummy,
                Notice: Dummy,
                TFile,
                WorkspaceLeaf: Dummy,
                normalizePath(value) { return String(value || '').replace(/\\\\/g, '/'); },
              },
              { get(target, key) { return key in target ? target[key] : Dummy; } },
            );
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString('base64')}`
  );
}

const sourceHelpers = await importModule('../src/utils/property-option-source.ts');
const settingHelpers = await importModule('../src/utils/property-option-setting.ts');
const settingsSource = readFileSync(
  new URL('../src/settings-tab.ts', import.meta.url),
  'utf8',
);

const {
  decodePropertyOptionSources,
  encodePropertyOptionSources,
  getPropertyOptionSources,
  isEntityOnlyProperty,
  propertyUsesEntityOptions,
  propertyUsesManualOptions,
  propertyUsesVaultOptions,
} = sourceHelpers;
const {
  applyAcceptedKindSetting,
  normalizeAcceptedKindSetting,
} = settingHelpers;

function sourceBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test('all seven supported source combinations normalize to canonical order', () => {
  const combinations = [
    ['manual'],
    ['vault'],
    ['entity'],
    ['manual', 'vault'],
    ['manual', 'entity'],
    ['vault', 'entity'],
    ['manual', 'vault', 'entity'],
  ];

  for (const expected of combinations) {
    const configured = [...expected].reverse();
    assert.deepEqual(
      getPropertyOptionSources({
        type: 'selector',
        acceptsKind: 'Project',
        optionSources: configured,
      }),
      expected,
      configured.join('+'),
    );
  }
});

test('legacy source settings migrate to their established canonical behavior', () => {
  assert.deepEqual(
    getPropertyOptionSources({ type: 'selector', optionsSource: 'manual' }),
    ['manual'],
  );
  assert.deepEqual(
    getPropertyOptionSources({ type: 'selector', optionsSource: 'vault' }),
    ['manual', 'vault'],
  );
  assert.deepEqual(
    getPropertyOptionSources({
      type: 'selector',
      acceptsKind: 'Project',
      optionsSource: 'manual',
    }),
    ['entity'],
    'legacy acceptsKind fields were entity-only before composable sources existed',
  );
});

test('entity sources require an accepted Kind and never apply to the Kind identity property', () => {
  assert.deepEqual(
    getPropertyOptionSources({
      type: 'selector',
      optionSources: ['entity'],
    }),
    ['manual'],
  );
  assert.deepEqual(
    getPropertyOptionSources({
      type: 'selector',
      optionSources: ['vault', 'entity'],
    }),
    ['vault'],
  );
  assert.deepEqual(
    getPropertyOptionSources({
      type: 'kind',
      acceptsKind: 'Status',
      optionSources: ['entity'],
    }),
    ['manual'],
  );
  assert.deepEqual(
    getPropertyOptionSources({
      type: 'kind',
      acceptsKind: 'Status',
      optionSources: ['vault', 'entity'],
    }),
    ['vault'],
  );
});

test('source capability helpers distinguish entity-only fields from mixed editable fields', () => {
  const entityOnly = {
    type: 'selector',
    acceptsKind: 'Status',
    optionSources: ['entity'],
  };
  assert.equal(propertyUsesEntityOptions(entityOnly), true);
  assert.equal(propertyUsesManualOptions(entityOnly), false);
  assert.equal(propertyUsesVaultOptions(entityOnly), false);
  assert.equal(isEntityOnlyProperty(entityOnly), true);

  const manualAndEntity = {
    type: 'selector',
    acceptsKind: 'Status',
    optionSources: ['manual', 'entity'],
  };
  assert.equal(propertyUsesEntityOptions(manualAndEntity), true);
  assert.equal(propertyUsesManualOptions(manualAndEntity), true);
  assert.equal(propertyUsesVaultOptions(manualAndEntity), false);
  assert.equal(isEntityOnlyProperty(manualAndEntity), false);

  const vaultAndEntity = {
    type: 'selector',
    acceptsKind: 'Status',
    optionSources: ['vault', 'entity'],
  };
  assert.equal(propertyUsesEntityOptions(vaultAndEntity), true);
  assert.equal(propertyUsesManualOptions(vaultAndEntity), false);
  assert.equal(propertyUsesVaultOptions(vaultAndEntity), true);
  assert.equal(isEntityOnlyProperty(vaultAndEntity), false);
});

test('source encoding and decoding preserve canonical source order', () => {
  assert.equal(
    encodePropertyOptionSources(['entity', 'manual', 'vault']),
    'manual+vault+entity',
  );
  assert.deepEqual(
    decodePropertyOptionSources('entity+manual+invalid+vault+manual'),
    ['manual', 'vault', 'entity'],
  );
});

test('accepted Kind settings persist multiple identities as one canonical legacy string', () => {
  assert.equal(
    normalizeAcceptedKindSetting([' Project ', 'Area\nPROJECT', ' context, AREA ']),
    'project, area, context',
  );
  assert.equal(normalizeAcceptedKindSetting(null), '');
});

test('manual property options preserve first-configured order while deduplicating', async () => {
  const { normalizeManualPropertyOptions } = await importModule(
    '../src/utils/property-options.ts',
    { stubObsidian: true },
  );

  assert.deepEqual(
    normalizeManualPropertyOptions([
      'working',
      'todo',
      'Holding',
      'TODO',
      'complete',
      'working',
    ]),
    ['working', 'todo', 'Holding', 'complete'],
  );
  assert.deepEqual(
    normalizeManualPropertyOptions('low, medium\nhigh, LOW'),
    ['low', 'medium', 'high'],
  );
});

test('adding an entity to a mixed text list preserves literals and canonicalizes only links', async () => {
  const {
    mergeMixedEntityReferenceList,
    removeMixedEntityReferenceListValues,
  } = await importModule('../src/utils/entity-property.ts');
  const {
    mergeMixedList,
    parseMixedListInput,
  } = await importModule('../src/utils/list-utils.ts');

  const opening = 'waiting, [[Projects/Alpha|Old alias]], [[Projects/A, Inc|A, Inc]]';
  assert.deepEqual(parseMixedListInput(opening), [
    'waiting',
    '[[Projects/Alpha|Old alias]]',
    '[[Projects/A, Inc|A, Inc]]',
  ]);

  const replaced = mergeMixedEntityReferenceList(
    opening,
    '[[Projects/Alpha|Alpha]]',
  );
  assert.deepEqual(replaced, [
    'waiting',
    '[[Projects/Alpha|Alpha]]',
    '[[Projects/A, Inc|A, Inc]]',
  ]);

  const added = mergeMixedEntityReferenceList(
    replaced,
    '[[Projects/Beta|Beta]]',
  );
  assert.deepEqual(added, [
    'waiting',
    '[[Projects/Alpha|Alpha]]',
    '[[Projects/A, Inc|A, Inc]]',
    '[[Projects/Beta|Beta]]',
  ]);
  assert.deepEqual(
    removeMixedEntityReferenceListValues(added, '[[Projects/Alpha|Different alias]]'),
    ['waiting', '[[Projects/A, Inc|A, Inc]]', '[[Projects/Beta|Beta]]'],
  );
  assert.deepEqual(
    mergeMixedList(added, 'needs review, [[Projects/C, Inc|C, Inc]]'),
    [
      'waiting',
      '[[Projects/Alpha|Alpha]]',
      '[[Projects/A, Inc|A, Inc]]',
      '[[Projects/Beta|Beta]]',
      'needs review',
      '[[Projects/C, Inc|C, Inc]]',
    ],
    'adding a literal must not split existing or incoming entity links at embedded commas',
  );
});

test('bulk list writes keep comma-bearing entity links atomic even when chosen as a literal', async () => {
  const { BulkEditService } = await importBulkEditService();
  const property = {
    id: 'people',
    key: 'people',
    label: 'People',
    type: 'list',
    listItemType: 'text',
    acceptsKind: 'person',
    optionSources: ['manual', 'vault', 'entity'],
  };
  const plugin = {
    app: {},
    settings: {
      enableRecurrence: false,
      promptOnRecurrenceEdit: false,
      properties: [property],
    },
  };
  const service = new BulkEditService(plugin);
  const frontmatter = { people: ['waiting'] };
  service.applyToFiles = async (files, mutate) => {
    mutate(frontmatter, files[0]);
    return 1;
  };

  const count = await service.addListValues(
    [{}],
    '[[People/Smith|Smith, Jane]]',
    'people',
    false,
  );

  assert.equal(count, 1);
  assert.deepEqual(frontmatter.people, [
    'waiting',
    '[[People/Smith|Smith, Jane]]',
  ]);
});

test('every entity-enabled list editor uses storage-aware mixed-list mutation', () => {
  const paths = [
    '../src/services/task-line-context-menu-service.ts',
    '../src/menu/line-entity-property-menu.ts',
    '../src/services/inline-property-suggest.ts',
    '../src/services/inline-property-decoration-service.ts',
    '../src/tps-list/views/TpsListView.ts',
    '../src/views/log-base-view.ts',
    '../src/menu/panel-builder.ts',
  ];
  for (const path of paths) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    if (path === '../src/views/log-base-view.ts') {
      assert.match(source, /addLogBaseListPropertyValue/);
      assert.match(source, /removeLogBaseListPropertyValue/);
      continue;
    }
    assert.match(
      source,
      /mergeMixedEntityReferenceList/,
      `${path} must preserve literals when its list storage is not link-only`,
    );
    assert.match(
      source,
      /mergeMixedList/,
      `${path} must preserve entity links when a literal is added to mixed storage`,
    );
  }

  const bulkEdit = readFileSync(
    new URL('../src/services/bulk-edit-service.ts', import.meta.url),
    'utf8',
  );
  assert.match(bulkEdit, /entityReference = false/);
  assert.match(
    bulkEdit,
    /propertyUsesEntityOptions\(property\)[\s\S]{0,100}\? parseMixedListInput\(value\)[\s\S]{0,100}: parseStringListInput\(value\)/,
  );
  assert.match(bulkEdit, /mergeMixedEntityReferenceList\(fm\[targetKey\], values\)/);
  assert.match(bulkEdit, /mergeMixedList\(fm\[targetKey\], values\)/);
  assert.match(bulkEdit, /removeMixedEntityReferenceListValues\(fm\[targetKey\], values\)/);
});

test('mixed-source option discovery preserves relational links and literal suggestions', async () => {
  const { normalizeManualPropertyOptions } = await importModule(
    '../src/utils/property-options.ts',
    { stubObsidian: true },
  );
  const property = {
    type: 'list',
    listItemType: 'text',
    acceptsKind: 'status',
    optionSources: ['manual', 'entity'],
  };
  assert.deepEqual(
    normalizeManualPropertyOptions(
      'waiting, [[Statuses/In Progress|In Progress]], [[Statuses/On Hold, External|On Hold, External]]',
      property,
    ),
    [
      'waiting',
      '[[Statuses/In Progress|In Progress]]',
      '[[Statuses/On Hold, External|On Hold, External]]',
    ],
  );
});

test('first setting an accepted Kind persists an explicit entity-only source', () => {
  const property = {
    id: 'status',
    key: 'status',
    label: 'Status',
    type: 'selector',
    optionsSource: 'vault',
  };

  applyAcceptedKindSetting(property, [' Project ', 'Area\nproject']);

  assert.equal(property.acceptsKind, 'project, area');
  assert.deepEqual(property.optionSources, ['entity']);
  assert.equal(property.optionsSource, 'manual');
  assert.deepEqual(getPropertyOptionSources(property), ['entity']);
});

test('accepted Kind set edits preserve an existing source mix and canonicalize legacy state', () => {
  const mixed = {
    id: 'project',
    key: 'project',
    label: 'Project',
    type: 'selector',
    acceptsKind: 'project',
    optionSources: ['manual', 'vault', 'entity'],
    optionsSource: 'vault',
  };
  applyAcceptedKindSetting(mixed, ' Initiative,\nArea, INITIATIVE ');
  assert.equal(mixed.acceptsKind, 'initiative, area');
  assert.deepEqual(mixed.optionSources, ['manual', 'vault', 'entity']);
  assert.equal(mixed.optionsSource, 'vault');

  const legacy = {
    id: 'context',
    key: 'context',
    label: 'Context',
    type: 'selector',
    acceptsKind: 'context',
    optionsSource: 'manual',
  };
  applyAcceptedKindSetting(legacy, 'place');
  assert.equal(legacy.acceptsKind, 'place');
  assert.deepEqual(legacy.optionSources, ['entity']);
  assert.equal(legacy.optionsSource, 'manual');
});

test('clearing an accepted Kind removes only entity sources and keeps a usable fallback', () => {
  const mixed = {
    id: 'project',
    key: 'project',
    label: 'Project',
    type: 'selector',
    acceptsKind: 'project',
    optionSources: ['manual', 'vault', 'entity'],
    optionsSource: 'vault',
  };
  applyAcceptedKindSetting(mixed, '');
  assert.equal(mixed.acceptsKind, undefined);
  assert.deepEqual(mixed.optionSources, ['manual', 'vault']);
  assert.equal(mixed.optionsSource, 'vault');

  const entityOnlyList = {
    id: 'projects',
    key: 'projects',
    label: 'Projects',
    type: 'list',
    acceptsKind: 'project',
    optionSources: ['entity'],
    optionsSource: 'manual',
    listItemType: 'link',
  };
  applyAcceptedKindSetting(entityOnlyList, ' ');
  assert.equal(entityOnlyList.acceptsKind, undefined);
  assert.deepEqual(entityOnlyList.optionSources, ['manual']);
  assert.equal(entityOnlyList.optionsSource, 'manual');
});

test('entity-only list defaults keep canonical link storage', () => {
  const property = {
    id: 'projects',
    key: 'projects',
    label: 'Projects',
    type: 'list',
    optionsSource: 'manual',
    listItemType: 'tag',
  };
  applyAcceptedKindSetting(property, 'project');
  assert.deepEqual(property.optionSources, ['entity']);
  assert.equal(property.listItemType, 'link');
});

test('Accepted kinds commits and source rerenders preserve focus without a delayed full display', () => {
  const acceptedKindsBlock = sourceBlock(
    settingsSource,
    ".setName('Accepted kinds')",
    '// Icon',
  );
  const refreshBlock = sourceBlock(
    settingsSource,
    'private refreshCustomPropertyValueSettings(',
    'private refreshPropertyValueSettingsWhenFocusLeaves(',
  );
  const sourceSettingsBlock = sourceBlock(
    settingsSource,
    'private renderPropertyOptionSettings(',
    'const chips = optionsDiv.createDiv',
  );

  assert.match(acceptedKindsBlock, /separated by commas or new lines/);
  assert.match(acceptedKindsBlock, /\.addTextArea\(/);
  assert.match(acceptedKindsBlock, /\.setPlaceholder\('project, area'\)/);
  assert.match(acceptedKindsBlock, /text\.inputEl\.rows = 2/);
  assert.match(acceptedKindsBlock, /const applyAcceptedKindsDraft = \(value: unknown\)/);
  assert.match(acceptedKindsBlock, /applyAcceptedKindSetting\(prop, nextAcceptedKinds\)/);
  assert.match(
    acceptedKindsBlock,
    /\.onChange\(async \(value\) => \{[\s\S]*?draftAcceptedKinds = value;[\s\S]*?applyAcceptedKindsDraft\(value\);[\s\S]*?await this\.plugin\.saveSettings\(\)/,
    'Accepted kinds must enter the queued settings persistence path while typing, without waiting for blur',
  );
  assert.match(acceptedKindsBlock, /commitAcceptedKinds\(event\.relatedTarget\)/);
  assert.match(acceptedKindsBlock, /syncPropertyValueSourceSelect\(valueSettingsHost, prop\)/);
  assert.match(acceptedKindsBlock, /refreshPropertyValueSettingsWhenFocusLeaves\(valueSettingsHost, prop\)/);
  assert.doesNotMatch(acceptedKindsBlock, /setTimeout\([\s\S]*?this\.display\(\)/);

  assert.match(refreshBlock, /const scrollTop = this\.containerEl\.scrollTop/);
  assert.match(refreshBlock, /this\.renderCustomPropertyValueSettings\(container, prop\)/);
  assert.match(refreshBlock, /\.focus\(\{ preventScroll: true \}\)/);
  assert.match(refreshBlock, /this\.containerEl\.scrollTop = scrollTop/);

  assert.match(sourceSettingsBlock, /dataset\.tpsGcmPropertyValueSources = 'true'/);
  assert.match(sourceSettingsBlock, /\.addOption\('entity', 'Entities only'\)/);
  assert.match(sourceSettingsBlock, /\.addOption\('manual\+entity', 'Manual \+ entities'\)/);
  assert.match(sourceSettingsBlock, /\.addOption\('vault\+entity', 'Vault \+ entities'\)/);
  assert.match(sourceSettingsBlock, /\.addOption\('manual\+vault\+entity', 'Manual \+ vault \+ entities'\)/);
  assert.match(sourceSettingsBlock, /document\.activeElement === drop\.selectEl/);
  assert.match(sourceSettingsBlock, /Task checkbox workflow remains separate as task\.status/);
  assert.doesNotMatch(sourceSettingsBlock, /this\.display\(\)/);
});
