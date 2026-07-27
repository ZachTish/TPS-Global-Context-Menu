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

test('line relationship visibility honors context rules, semantic tags, and @@ independence', async () => {
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
    ['projects', 'contexts', 'owner'],
    'blank and missing fields remain distinct, hidden fields stay hidden, and semantic inline tags satisfy scope',
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

test('every synthesized non-task row routes configured relationships to its own stale-safe line menu', () => {
  assert.match(source, /openEntitySuggestModal/);
  assert.match(source, /mergeEntityReferenceList/);
  assert.match(source, /removeEntityReferenceListValues/);
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
  assert.match(listSource, /excludeCustomPropertyKeys:\s*getConfiguredEntityReferencePropertyKeys\(plugin\)/);
  assert.match(menuBuilderSource, /excludeCustomPropertyKeys\?:\s*readonly string\[\]/);
  assert.match(menuBuilderSource, /excludedPropertyKeys\.has\(String\(prop\.key/);

  assert.match(tableSource, /addLineEntityPropertyMenus\(\{[\s\S]*?this\.updateEntryLine\(entry, updater\)/);
  assert.match(
    tableSource,
    /!isEntityReferenceProperty\(\s*resolveConfiguredProperty\(this\.plugin\.settings\.properties \|\| \[\], column\.key\)/,
    'configured entity columns cannot leak back to the generic free-text context editor',
  );
});

test('whole-note list relationships also reach the constrained picker before generic list input', () => {
  const listModalStart = menuControllerSource.indexOf('openAddListValueModal(');
  const listModalEnd = menuControllerSource.indexOf('\n  openRecurrenceModalNative(', listModalStart);
  assert.notEqual(listModalStart, -1);
  assert.notEqual(listModalEnd, -1);
  const listModal = menuControllerSource.slice(listModalStart, listModalEnd);
  assert.match(listModal, /if \(isEntityReferenceProperty\(property\)\)/);
  assert.match(listModal, /openEntitySuggestModal\(this\.app, this\.plugin, property/);
  assert.match(listModal, /this\.plugin\.bulkEditService\.addListValues\(files, choice\.wikilink, key\)/);
  assert.match(listModal, /return;[\s\S]*?if \(isLinkListProperty\(property\)\)/);
  assert.match(menuBuilderSource, /this\.delegates\.openAddListValueModal\(entries, prop\.key, prop\.label\)/);
});
