import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadPreviewModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/utils/pointer-drag-preview.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function createElement() {
  return {
    className: '',
    textContent: '',
    children: [],
    attributes: new Map(),
    style: {},
    isConnected: false,
    setAttribute(name, value) { this.attributes.set(name, value); },
    appendChild(child) { this.children.push(child); },
    remove() { this.isConnected = false; this.removed = true; },
  };
}

function createDocument() {
  const appended = [];
  return {
    appended,
    createElement,
    body: {
      appendChild(el) {
        el.isConnected = true;
        appended.push(el);
      },
    },
  };
}

test('custom TPS Base pointer drag preview is connected, follows the pointer, and cleans up', async () => {
  const { createPointerDragPreview, movePointerDragPreview, removePointerDragPreview } = await loadPreviewModule();
  const ownerDocument = createDocument();
  const preview = createPointerDragPreview(ownerDocument, 'One task', 1, 10.2, 20.6);

  assert.equal(ownerDocument.appended.length, 1);
  assert.equal(preview.el.className, 'tps-gcm-pointer-drag-preview');
  assert.equal(preview.el.attributes.get('aria-hidden'), 'true');
  assert.equal(preview.el.children[1].textContent, 'One task');
  assert.equal(preview.el.style.transform, 'translate3d(26px, 37px, 0)');

  movePointerDragPreview(preview, 50, 70);
  assert.equal(preview.el.style.transform, 'translate3d(66px, 86px, 0)');
  removePointerDragPreview(preview);
  assert.equal(preview.el.removed, true);
});

test('multi-selection preview exposes a compact count instead of one misleading title', async () => {
  const { createPointerDragPreview } = await loadPreviewModule();
  const ownerDocument = createDocument();
  const preview = createPointerDragPreview(ownerDocument, 'First task', 4, 0, 0);

  assert.equal(preview.el.children[0].textContent, '4');
  assert.equal(preview.el.children[1].textContent, '4 selected tasks');
});
