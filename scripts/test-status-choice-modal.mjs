import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadStatusChoiceModal() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/modals/status-choice-modal.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'status-choice-modal-obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian',
          namespace: 'status-choice-modal-obsidian',
        }));
        builder.onLoad({ filter: /.*/u, namespace: 'status-choice-modal-obsidian' }, () => ({
          loader: 'js',
          contents: `
            class FakeElement {
              constructor(tag = 'div', text = '') {
                this.tag = tag;
                this.text = text;
                this.children = [];
                this.listeners = new Map();
                this.style = {};
              }

              addClass() {}

              empty() {
                this.children.length = 0;
              }

              createEl(tag, options = {}) {
                const child = new FakeElement(tag, String(options.text ?? ''));
                this.children.push(child);
                return child;
              }

              createDiv(options = {}) {
                return this.createEl('div', options);
              }

              addEventListener(type, listener) {
                this.listeners.set(type, listener);
              }

              click() {
                this.listeners.get('click')?.();
              }
            }

            export class App {}

            export class Modal {
              constructor(app) {
                this.app = app;
                this.modalEl = new FakeElement();
                this.contentEl = new FakeElement();
              }

              open() {
                this.onOpen?.();
              }

              close() {
                this.onClose?.();
              }
            }
          `,
        }));
      },
    }],
  });

  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function findButton(root, text) {
  if (root.tag === 'button' && root.text === text) return root;
  for (const child of root.children) {
    const match = findButton(child, text);
    if (match) return match;
  }
  return null;
}

test('a status choice settles once with the selected value', async () => {
  const { StatusChoiceModal } = await loadStatusChoiceModal();
  const choices = [];
  const modal = new StatusChoiceModal({}, ['working', 'complete'], (choice) => choices.push(choice));

  modal.open();
  const button = findButton(modal.contentEl, 'complete');
  assert.ok(button);
  button.click();
  modal.close();

  assert.deepEqual(choices, ['complete']);
  assert.equal(modal.contentEl.children.length, 0);
});

test('Cancel settles once with null', async () => {
  const { StatusChoiceModal } = await loadStatusChoiceModal();
  const choices = [];
  const modal = new StatusChoiceModal({}, ['complete'], (choice) => choices.push(choice));

  modal.open();
  const button = findButton(modal.contentEl, 'Cancel');
  assert.ok(button);
  button.click();
  modal.close();

  assert.deepEqual(choices, [null]);
  assert.equal(modal.contentEl.children.length, 0);
});

test('closing through Escape or backdrop settles once with null', async () => {
  const { StatusChoiceModal } = await loadStatusChoiceModal();
  const choices = [];
  const modal = new StatusChoiceModal({}, ['complete'], (choice) => choices.push(choice));

  modal.open();
  modal.close();
  modal.close();

  assert.deepEqual(choices, [null]);
  assert.equal(modal.contentEl.children.length, 0);
});
