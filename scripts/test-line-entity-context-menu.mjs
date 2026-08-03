import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = readFileSync(
  new URL('../src/menu/line-entity-property-menu.ts', import.meta.url),
  'utf8',
);
const listSource = readFileSync(
  new URL('../src/tps-list/views/TpsListView.ts', import.meta.url),
  'utf8',
);
const tableSource = readFileSync(
  new URL('../src/views/log-base-view.ts', import.meta.url),
  'utf8',
);
const menuBuilderSource = readFileSync(
  new URL('../src/menu/menu-builder.ts', import.meta.url),
  'utf8',
);
const menuControllerSource = readFileSync(
  new URL('../src/menu/menu-controller.ts', import.meta.url),
  'utf8',
);
const contextTargetSource = readFileSync(
  new URL('../src/services/context-target-service.ts', import.meta.url),
  'utf8',
);

async function loadHarness() {
  const result = await build({
    entryPoints: [
      fileURLToPath(new URL('../src/menu/line-entity-property-menu.ts', import.meta.url)),
      fileURLToPath(new URL('../src/utils/task-line-metadata.ts', import.meta.url)),
      fileURLToPath(new URL('../src/views/log-line-utils.ts', import.meta.url)),
    ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    outdir: 'out',
    logLevel: 'silent',
    splitting: false,
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian',
          namespace: 'line-entity-menu-test',
        }));
        builder.onLoad({ filter: /.*/u, namespace: 'line-entity-menu-test' }, () => ({
          contents: `
            class Dummy {
              constructor() {}
              open() {}
            }
            class Notice extends Dummy {}
            const api = new Proxy(
              {
                FuzzySuggestModal: Dummy,
                Modal: Dummy,
                Notice,
                TFile: Dummy,
                WorkspaceLeaf: Dummy,
              },
              { get(target, key) { return key in target ? target[key] : Dummy; } },
            );
            module.exports = api;
          `,
          loader: 'js',
        }));
      },
    }],
  });
  const modules = {};
  for (const output of result.outputFiles) {
    const imported = await import(
      `data:text/javascript;base64,${Buffer.from(output.text).toString('base64')}`
    );
    Object.assign(modules, imported);
  }
  return modules;
}

class FakeMenuItem {
  title = '';
  checked = false;
  click = null;
  submenu = null;

  setTitle(value) {
    this.title = String(value);
    return this;
  }

  setIcon() {
    return this;
  }

  setSection() {
    return this;
  }

  setChecked(value) {
    this.checked = value === true;
    return this;
  }

  onClick(callback) {
    this.click = callback;
    return this;
  }

  setSubmenu() {
    this.submenu = new FakeMenu();
    return this.submenu;
  }
}

class FakeMenu {
  items = [];

  addItem(builder) {
    const item = new FakeMenuItem();
    builder(item);
    this.items.push(item);
    return this;
  }

  addSeparator() {
    this.items.push({ separator: true });
    return this;
  }
}

function createPlugin(properties, showCustomPropertiesInContextMenu = true) {
  return {
    app: {},
    settings: {
      properties,
      showCustomPropertiesInContextMenu,
    },
  };
}

function createOptionApp(frontmatters) {
  const files = frontmatters.map((frontmatter, index) => ({
    path: `Options/${index + 1}.md`,
    basename: String(index + 1),
  }));
  return {
    vault: {
      getMarkdownFiles: () => files,
    },
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: frontmatters[files.indexOf(file)] || {},
      }),
    },
  };
}

test('line property visibility honors context rules, semantic tags, and @@ independence', async () => {
  const { resolveLineEntityContextProperties } = await loadHarness();
  const properties = [
    {
      id: 'projects',
      key: 'Projects',
      label: 'Projects',
      type: 'list',
      listItemType: 'link',
      acceptsKind: 'project',
      showInContextMenu: true,
      contextMenuShowWhen: 'blank',
      allowInlineSet: false,
    },
    {
      id: 'contexts',
      key: 'Contexts',
      label: 'Contexts',
      type: 'list',
      listItemType: 'link',
      acceptsKind: 'context',
      showInContextMenu: true,
      contextMenuShowWhen: 'missing',
    },
    {
      id: 'owner',
      key: 'Owner',
      label: 'Owner',
      type: 'text',
      acceptsKind: 'person',
      showInContextMenu: true,
      scopeTags: ['waiting'],
    },
    {
      id: 'team',
      key: 'Team',
      label: 'Team',
      type: 'text',
      acceptsKind: 'team',
      showInContextMenu: true,
      scopeTags: ['not-present'],
    },
    {
      id: 'hidden',
      key: 'Hidden',
      label: 'Hidden',
      type: 'text',
      acceptsKind: 'project',
      showInContextMenu: false,
    },
    {
      id: 'identity',
      key: 'kind',
      label: 'Kind',
      type: 'kind',
      acceptsKind: 'project',
      showInContextMenu: true,
    },
  ];
  const file = { path: 'Examples/Relational Records.md' };
  const line = '- Relational row [Projects:: ] [tags:: #waiting]';

  assert.deepEqual(
    resolveLineEntityContextProperties(createPlugin(properties), file, line)
      .map((property) => property.id),
    ['projects', 'contexts', 'owner', 'identity'],
    'blank and missing fields remain distinct, hidden fields stay hidden, semantic inline tags satisfy scope, and Kind remains writable',
  );
  assert.deepEqual(
    resolveLineEntityContextProperties(createPlugin(properties, false), file, line),
    [],
    'the global context-menu switch remains authoritative',
  );
});

test('line relationship list menus remove one value or clear the field without damaging the row', async () => {
  const harness = await loadHarness();
  const property = {
    id: 'projects',
    key: 'Projects',
    label: 'Projects',
    type: 'list',
    listItemType: 'link',
    acceptsKind: 'project',
    showInContextMenu: true,
  };
  const file = { path: 'Examples/Relational Records.md' };
  let line = '- Relational row [Projects:: [[Projects/Alpha|Alpha]], [[Projects/Beta|Beta]]] [status:: working] ^rel-row';
  const buildMenu = () => {
    const menu = new FakeMenu();
    harness.addLineEntityPropertyMenus({
      app: {},
      plugin: createPlugin([property]),
      menu,
      file,
      rawLine: line,
      mutateLine: async (updater) => {
        line = updater(line);
        return true;
      },
    });
    return menu;
  };

  const firstMenu = buildMenu();
  assert.equal(firstMenu.items.length, 1);
  assert.equal(firstMenu.items[0].title, 'Projects: Alpha, Beta');
  const removeAlpha = firstMenu.items[0].submenu.items.find(
    (item) => item.title === 'Remove Alpha',
  );
  assert.equal(typeof removeAlpha?.click, 'function');
  removeAlpha.click();
  assert.equal(
    harness.readInlineFieldValue(line, 'Projects'),
    '[[Projects/Beta|Beta]]',
  );
  assert.equal(harness.readInlineFieldValue(line, 'status'), 'working');
  assert.match(line, /\^rel-row$/u);

  const secondMenu = buildMenu();
  const clear = secondMenu.items[0].submenu.items.find(
    (item) => item.title === '(none)',
  );
  assert.equal(typeof clear?.click, 'function');
  clear.click();
  assert.equal(harness.readInlineFieldValue(line, 'Projects'), '');
  assert.equal(harness.readInlineFieldValue(line, 'status'), 'working');
  assert.match(line, /Relational row/u);
  assert.match(line, /\^rel-row$/u);
});

test('line selector menus honor a vault-only source without exposing raw custom input', async () => {
  const harness = await loadHarness();
  const property = {
    id: 'priority',
    key: 'priority',
    label: 'Priority',
    type: 'selector',
    optionSources: ['vault'],
    showInContextMenu: true,
  };
  const app = createOptionApp([
    { priority: 'low' },
    { priority: 'high' },
  ]);
  const file = { path: 'Examples/Relational Records.md' };
  let line = '- Relational row [priority:: low] [owner:: Zach] ^vault-selector';
  const menu = new FakeMenu();
  harness.addLineEntityPropertyMenus({
    app,
    plugin: createPlugin([property]),
    menu,
    file,
    rawLine: line,
    mutateLine: async (updater) => {
      line = updater(line);
      return true;
    },
  });

  assert.equal(menu.items.length, 1);
  assert.equal(menu.items[0].title, 'Priority: low');
  const submenuTitles = menu.items[0].submenu.items
    .filter((item) => !item.separator)
    .map((item) => item.title);
  assert.deepEqual(submenuTitles, ['(none)', 'high', 'low']);
  assert.equal(
    submenuTitles.includes('Set custom value…'),
    false,
    'vault-only selectors must not fall back to a raw text editor',
  );

  menu.items[0].submenu.items.find((item) => item.title === 'high').click();
  assert.equal(harness.readInlineFieldValue(line, 'priority'), 'high');
  assert.equal(harness.readInlineFieldValue(line, 'owner'), 'Zach');
  assert.match(line, /\^vault-selector$/u);
});

test('line text-list menus merge manual and vault choices instead of replacing the field', async () => {
  const harness = await loadHarness();
  const property = {
    id: 'labels',
    key: 'labels',
    label: 'Labels',
    type: 'list',
    listItemType: 'text',
    optionSources: ['manual', 'vault'],
    options: ['manual-first'],
    showInContextMenu: true,
  };
  const app = createOptionApp([
    { labels: ['vault-alpha'] },
    { labels: 'vault-beta' },
  ]);
  const file = { path: 'Examples/Relational Records.md' };
  let line = '- Bullet row [labels:: existing] [priority:: high] ^vault-list';
  const menu = new FakeMenu();
  harness.addLineEntityPropertyMenus({
    app,
    plugin: createPlugin([property]),
    menu,
    file,
    rawLine: line,
    mutateLine: async (updater) => {
      line = updater(line);
      return true;
    },
  });

  const submenuTitles = menu.items[0].submenu.items
    .filter((item) => !item.separator)
    .map((item) => item.title);
  assert.deepEqual(
    submenuTitles,
    [
      '(none)',
      'Set custom value…',
      'manual-first',
      'vault-alpha',
      'vault-beta',
      'Remove existing',
    ],
  );

  menu.items[0].submenu.items.find((item) => item.title === 'vault-beta').click();
  assert.equal(harness.readInlineFieldValue(line, 'labels'), 'existing, vault-beta');
  assert.equal(harness.readInlineFieldValue(line, 'priority'), 'high');
  assert.match(line, /\^vault-list$/u);
});

test('entity-enabled tag lists keep literals and relational wikilinks in mixed inline storage', async () => {
  const harness = await loadHarness();
  const property = {
    id: 'tags',
    key: 'tags',
    label: 'Tags',
    type: 'list',
    listItemType: 'tag',
    acceptsKind: 'status',
    optionSources: ['manual', 'entity'],
    options: ['manual-literal'],
    showInContextMenu: true,
  };
  const file = { path: 'Examples/Relational Records.md' };
  let line = '- Relational row [tags:: #waiting, [[Statuses/Smith|Smith, Jane]]] [priority:: high] ^entity-tag-list';
  const buildMenu = () => {
    const menu = new FakeMenu();
    harness.addLineEntityPropertyMenus({
      app: {},
      plugin: createPlugin([property]),
      menu,
      file,
      rawLine: line,
      mutateLine: async (updater) => {
        line = updater(line);
        return true;
      },
    });
    return menu;
  };

  const addMenu = buildMenu();
  assert.equal(addMenu.items[0].title, 'Tags: #waiting, Smith, Jane');
  addMenu.items[0].submenu.items
    .find((item) => item.title === 'manual-literal')
    .click();
  assert.equal(
    harness.readInlineFieldValue(line, 'tags'),
    '#waiting, [[Statuses/Smith|Smith, Jane]], manual-literal',
    'a manual value must merge without splitting the entity alias at its comma',
  );
  assert.equal(harness.readInlineFieldValue(line, 'priority'), 'high');
  assert.match(line, /\^entity-tag-list$/u);

  const removeMenu = buildMenu();
  const removeEntity = removeMenu.items[0].submenu.items.find(
    (item) => item.title === 'Remove Smith, Jane',
  );
  assert.equal(typeof removeEntity?.click, 'function');
  removeEntity.click();
  assert.equal(
    harness.readInlineFieldValue(line, 'tags'),
    '#waiting, manual-literal',
    'removing one entity must preserve literal values in the relational tag field',
  );

  const clearMenu = buildMenu();
  clearMenu.items[0].submenu.items.find((item) => item.title === '(none)').click();
  assert.equal(harness.readInlineFieldValue(line, 'tags'), '');
  assert.equal(harness.readInlineFieldValue(line, 'priority'), 'high');
  assert.match(line, /\^entity-tag-list$/u);
});

test('line context menus compose manual and Kind-constrained entity sources without hardcoded field behavior', async () => {
  const harness = await loadHarness();
  const property = {
    id: 'status',
    key: 'status',
    label: 'Status',
    type: 'selector',
    acceptsKind: 'status',
    optionSources: ['manual', 'entity'],
    options: ['working', 'blocked'],
    showInContextMenu: true,
  };
  const file = { path: 'Examples/Relational Records.md' };
  let line = '- Relational row [status:: [[Statuses/Todo|Todo]]] [priority:: high] ^rel-status';
  const menu = new FakeMenu();
  harness.addLineEntityPropertyMenus({
    app: {},
    plugin: createPlugin([property]),
    menu,
    file,
    rawLine: line,
    mutateLine: async (updater) => {
      line = updater(line);
      return true;
    },
  });

  assert.equal(menu.items.length, 1);
  assert.equal(menu.items[0].title, 'Status: Todo');
  const submenuTitles = menu.items[0].submenu.items
    .filter((item) => !item.separator)
    .map((item) => item.title);
  assert.deepEqual(
    submenuTitles,
    ['(none)', 'Set custom value…', 'working', 'blocked', 'Choose status entity…'],
    'manual values and the constrained entity route must coexist in the configured order',
  );

  const working = menu.items[0].submenu.items.find((item) => item.title === 'working');
  assert.equal(typeof working?.click, 'function');
  working.click();
  assert.equal(harness.readInlineFieldValue(line, 'status'), 'working');
  assert.equal(harness.readInlineFieldValue(line, 'priority'), 'high');
  assert.match(line, /\^rel-status$/u);
});

test('line context menus prioritize entity sources over native property-type editors', async () => {
  const harness = await loadHarness();
  const file = { path: 'Examples/Relational Records.md' };
  for (const type of ['datetime', 'snooze', 'recurrence', 'checkbox']) {
    const property = {
      id: `related-${type}`,
      key: `related${type}`,
      label: `Related ${type}`,
      type,
      acceptsKind: 'project, area',
      optionSources: ['entity'],
      showInContextMenu: true,
    };
    const menu = new FakeMenu();
    harness.addLineEntityPropertyMenus({
      app: {},
      plugin: createPlugin([property]),
      menu,
      file,
      rawLine: '- Relational row ^typed-entity',
      mutateLine: async () => true,
    });

    assert.equal(menu.items.length, 1, type);
    assert.ok(menu.items[0].submenu, `${type} must use the relational submenu`);
    assert.deepEqual(
      menu.items[0].submenu.items
        .filter((item) => !item.separator)
        .map((item) => item.title),
      ['(none)', 'Choose matching entity (project or area)…'],
      `${type} must not route to its native type editor when entity options are enabled`,
    );
  }
});

test('every synthesized non-task row routes configured relationships to its own stale-safe line menu', () => {
  assert.match(source, /addPropertyValueChoiceMenuItems/);
  assert.match(
    source,
    /const entityOptions = propertyUsesEntityOptions\(property\);[\s\S]*?if \(!entityOptions && \(property\.type === 'datetime' \|\| property\.type === 'snooze'\)\)/,
  );
  assert.match(source, /onChooseLiteral: \(value\) => setChoice\(value, false\)/);
  assert.match(source, /onChooseEntity: \(choice\) => setChoice\(choice\.wikilink, true\)/);
  assert.match(source, /mergeEntityReferenceList/);
  assert.match(source, /mergeMixedEntityReferenceList/);
  assert.match(source, /mergeLinkList/);
  assert.match(source, /mergeMixedList/);
  assert.match(source, /removeEntityReferenceListValues/);
  assert.match(source, /removeMixedEntityReferenceListValues/);
  assert.match(source, /mergeStringList/);
  assert.match(source, /removeStringListValues/);
  assert.match(source, /addLineCheckboxPropertyMenu/);
  assert.match(source, /addLineDatetimePropertyMenu/);
  assert.match(source, /addLineRecurrencePropertyMenu/);
  assert.doesNotMatch(source, /TextInputModal|freeText|customValue/);

  const listMenuRoutes = listSource.match(/addLineEntityPropertyMenus\(\{/gu) || [];
  assert.equal(listMenuRoutes.length, 2, 'TPS List bullet and heading menus both use the line-local builder');
  assert.match(listSource, /updateRenderedLineEntityProperty\([\s\S]*?resolveExactLineRevisionIndex/);
  assert.match(
    listSource,
    /createListHeadingRow\([\s\S]*?row\.dataset\.tpsLineContext = 'true';[\s\S]*?openHeadingLineContextMenu/,
    'TPS List heading rows identify themselves as line-owned context targets',
  );
  assert.match(
    contextTargetSource,
    /target\.closest\('\[data-tps-task-context="true"\], \[data-tps-line-context="true"\]'\)/,
    'the document-level note interceptor yields to task and non-task line menus',
  );
  assert.match(listSource, /excludeCustomPropertyKeys:\s*getConfiguredLineContextPropertyKeys\(plugin\)/);
  assert.match(menuBuilderSource, /excludeCustomPropertyKeys\?:\s*readonly string\[\]/);
  assert.match(menuBuilderSource, /createCustomPropertyMenuExclusionPredicate\(\{[\s\S]{0,160}excludeCustomPropertyKeys/);
  assert.match(menuBuilderSource, /isExcludedCustomProperty\(prop\)/);

  assert.match(tableSource, /addLineEntityPropertyMenus\(\{[\s\S]*?this\.updateEntryLine\(entry, updater\)/);
  assert.match(
    tableSource,
    /!resolveConfiguredProperty\(this\.plugin\.settings\.properties \|\| \[\], column\.key\)/,
    'no configured column can leak back to the generic free-text context editor',
  );
});

test('whole-note selector and list menus enforce configured value sources', () => {
  const listModalStart = menuControllerSource.indexOf('openAddListValueModal(');
  const listModalEnd = menuControllerSource.indexOf('\n  openRecurrenceModalNative(', listModalStart);
  assert.notEqual(listModalStart, -1);
  assert.notEqual(listModalEnd, -1);
  const listModal = menuControllerSource.slice(listModalStart, listModalEnd);
  assert.match(listModal, /if \(isEntityReferenceProperty\(property\)\)/);
  assert.match(listModal, /openPropertyValueSuggestModal\(this\.app, this\.plugin, property!, ''/);
  assert.match(listModal, /if \(choice\.kind === 'clear'\)[\s\S]*?removeFrontmatterKey\(files, key\)[\s\S]*?return;/);
  assert.match(
    listModal,
    /this\.plugin\.bulkEditService\.addListValues\([\s\S]*?files,[\s\S]*?choice\.value,[\s\S]*?key,[\s\S]*?choice\.kind === 'entity'/,
  );
  assert.match(listModal, /\$\{label\} \$\{choice\.label\}/);
  assert.match(listModal, /return;[\s\S]*?if \(isLinkListProperty\(property\)\)/);

  const selectorStart = menuBuilderSource.indexOf('  addSelectorToMenu(menu: GcmMenuSink');
  const selectorEnd = menuBuilderSource.indexOf('\n  addEntityReferenceToMenu(', selectorStart);
  const selector = menuBuilderSource.slice(selectorStart, selectorEnd);
  assert.match(selector, /addPropertyValueChoiceMenuItems/);
  assert.match(selector, /onChooseLiteral: \(value\) => this\.setContextPropertyValue/);
  assert.match(selector, /onChooseEntity: \(choice\) => this\.setContextPropertyValue/);
  assert.doesNotMatch(selector, /TextInputModal|Set custom value|getEffectivePropertyOptions/);

  const listStart = menuBuilderSource.indexOf('  addListToMenu(menu: GcmMenuSink');
  const listEnd = menuBuilderSource.indexOf('\n  addDatetimeToMenu(', listStart);
  const list = menuBuilderSource.slice(listStart, listEnd);
  assert.match(list, /this\.populateListSubmenu\(subMenu, entries, prop, items\)/);
  assert.match(list, /addPropertyValueChoiceMenuItems/);
  assert.match(list, /this\.addContextTagValue/);
  assert.match(list, /this\.addContextListValue/);
  assert.match(list, /this\.removeContextProperty/);
  assert.match(list, /this\.removeContextTagValue/);
  assert.match(list, /this\.removeContextListValue/);
  assert.doesNotMatch(list, /openAddListValueModal|openAddTagModal|TextInputModal/);
});
