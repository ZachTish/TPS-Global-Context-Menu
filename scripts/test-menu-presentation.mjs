import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/menu/menu-presentation.ts', import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

class FakeClassList {
  values = new Set();
  add(value) { this.values.add(value); }
}

class FakeElement {
  classList = new FakeClassList();
  attributes = new Map();
  setAttribute(key, value) { this.attributes.set(key, value); }
  querySelector() { return this; }
}

class FakeItem {
  dom = new FakeElement();
  titleEl = this.dom;
  title = '';
  setTitle(value) { this.title = String(value); return this; }
  setSubmenu() { this.submenu = new FakeMenu(); return this.submenu; }
}

class FakeMenu {
  dom = new FakeElement();
  items = [];
  addItem(callback) {
    const item = new FakeItem();
    callback(item);
    this.items.push(item);
    return this;
  }
}

test('menu presentation bounds visible values and preserves the complete accessible label', async () => {
  const { GCM_MENU_LABEL_MAX_CHARACTERS, constrainGcmMenu } = await loadModule();
  const menu = constrainGcmMenu(new FakeMenu(), { truncateText: true });
  const full = 'Priority: an exceptionally long configured value';
  menu.addItem((item) => {
    item.setTitle(full);
    const submenu = item.setSubmenu();
    submenu.addItem((child) => child.setTitle(full));
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(Array.from(menu.items[0].title).length, GCM_MENU_LABEL_MAX_CHARACTERS);
  assert.equal(menu.items[0].title.endsWith('…'), true);
  assert.equal(menu.items[0].dom.attributes.get('title'), full);
  assert.equal(menu.items[0].dom.attributes.get('aria-label'), full);
  assert.equal(menu.items[0].submenu.items[0].title, menu.items[0].title);
  assert.equal(menu.dom.classList.values.has('tps-gcm-bounded-menu'), true);
  assert.equal(menu.items[0].dom.classList.values.has('tps-gcm-bounded-menu-item'), true);
});

test('host-owned item text stays intact while the scoped CSS class still bounds it visually', async () => {
  const { constrainGcmMenu } = await loadModule();
  const menu = constrainGcmMenu(new FakeMenu());
  const full = 'Create file properties note';
  menu.addItem((item) => item.setTitle(full));
  assert.equal(menu.items[0].title, full);
  assert.equal(menu.items[0].dom.attributes.get('title'), full);
});
