import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function loadStatusBarService(isMobile = false) {
  const build = await esbuild.build({
    entryPoints: [
      fileURLToPath(new URL('../src/services/time-tracking-status-bar-service.ts', import.meta.url)),
    ],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-status-bar-test-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({
          path: 'obsidian',
          namespace: 'status-bar-test-stub',
        }));
        builder.onLoad(
          { filter: /.*/, namespace: 'status-bar-test-stub' },
          () => ({
            loader: 'js',
            contents: `
              export class Menu {
                addItem(configure) {
                  const item = {
                    setTitle() { return this; },
                    setIcon() { return this; },
                    onClick(handler) { this.handler = handler; return this; },
                  };
                  configure(item);
                  return this;
                }
                showAtMouseEvent() {}
              }
              export class Notice {}
              export const Platform = { isMobile: ${isMobile ? 'true' : 'false'} };
              export function setIcon() {}
            `,
          }),
        );
      },
    }],
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

class FakeElement {
  constructor(name = 'element') {
    this.name = name;
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    this.classes = new Set();
    this.textContent = '';
    this.parentElement = null;
    this.removed = false;
    this.classList = { add: (...values) => values.forEach((value) => this.classes.add(value)) };
  }

  addClass(value) {
    this.classes.add(value);
  }

  toggleClass(value, enabled) {
    if (enabled) this.classes.add(value);
    else this.classes.delete(value);
  }

  remove() {
    this.removed = true;
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  }

  empty() {
    this.children.forEach((child) => { child.parentElement = null; });
    this.children = [];
    this.textContent = '';
  }

  createDiv() {
    return this.appendChild(new FakeElement('div'));
  }

  createEl(tag) {
    return this.appendChild(new FakeElement(tag));
  }

  createSpan() {
    return this.appendChild(new FakeElement('span'));
  }

  appendChild(child) {
    child.removeFromParent();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  closest() {
    return null;
  }

  removeFromParent() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  prepend(child) {
    child.removeFromParent();
    child.parentElement = this;
    this.children.unshift(child);
  }

  insertBefore(child, reference) {
    child.removeFromParent();
    const index = this.children.indexOf(reference);
    child.parentElement = this;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  matches(selector) {
    if (!selector.startsWith('.')) return false;
    return this.classes.has(selector.slice(1));
  }

  querySelector(selector) {
    if (this.matches(selector)) return this;
    for (const child of this.children) {
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }

  get nextElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index >= 0 ? this.parentElement.children[index + 1] ?? null : null;
  }

  get visibleText() {
    return [this.textContent, ...this.children.map((child) => child.visibleText)]
      .filter(Boolean)
      .join(' ');
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function activeStatus(title = 'Old timer') {
  return {
    active: {
      id: 'session-1',
      targetId: 'target-1',
      title,
      start: '2026-07-30 12:00:00',
    },
    paused: null,
  };
}

function pausedStatus(title = 'Paused timer') {
  return {
    active: null,
    paused: {
      targetId: 'target-1',
      targetType: 'note',
      sourcePath: 'Inbox/Timer.md',
      title,
      pausedAt: '2026-07-30 12:01:00',
      elapsedMs: 60_000,
    },
  };
}

function createHarness(statusResults, options = {}) {
  const intervalCallbacks = [];
  const statusItems = [];
  const createdElements = [];
  const workspaceHandlers = new Map();
  let statusBarCalls = 0;
  let statusReadCount = 0;
  const leafContainer = new FakeElement('leaf');
  const viewContent = new FakeElement('view-content');
  viewContent.addClass('view-content');
  leafContainer.appendChild(viewContent);
  const plugin = {
    settings: { enableTimeTracking: true },
    addStatusBarItem() {
      statusBarCalls += 1;
      const item = new FakeElement(`status-${statusItems.length + 1}`);
      statusItems.push(item);
      return item;
    },
    registerInterval() {},
    registerEvent() {},
    app: {
      workspace: {
        activeLeaf: { containerEl: leafContainer, view: { containerEl: viewContent } },
        onLayoutReady(callback) {
          plugin.layoutReadyCallback = callback;
        },
        on(name, callback) {
          workspaceHandlers.set(name, callback);
          return { name, callback };
        },
      },
    },
    timeTrackingService: {
      async getRuntimeStatus() {
        const result = statusResults[statusReadCount];
        statusReadCount += 1;
        if (result === undefined) throw new Error(`Unexpected status read ${statusReadCount}`);
        return await result;
      },
      getElapsedMsForSession() {
        return 60_000;
      },
      formatElapsed() {
        return '01:00';
      },
      async openHydratedSessionTarget() {
        return true;
      },
      async openHydratedSessionNotes() {
        plugin.openedNotes = (plugin.openedNotes || 0) + 1;
        return true;
      },
      async openPausedTimerTarget() {
        return true;
      },
      async openPausedTimerNotes() {
        plugin.openedNotes = (plugin.openedNotes || 0) + 1;
        return true;
      },
      async openSessionTarget() {
        return true;
      },
      async pauseActiveTimer() {
        return null;
      },
      async resumePausedTimer() {
        return null;
      },
      async stopActiveTimer() {
        return null;
      },
      async clearPausedTimer() {
        return false;
      },
    },
  };

  globalThis.document = {
    createElement(tag) {
      const element = new FakeElement(tag);
      createdElements.push(element);
      return element;
    },
    querySelector: () => null,
  };
  globalThis.window = {
    setInterval(callback) {
      intervalCallbacks.push(callback);
      return intervalCallbacks.length;
    },
  };

  return {
    plugin,
    intervalCallbacks,
    statusItems,
    createdElements,
    leafContainer,
    viewContent,
    workspaceHandlers,
    get statusBarCalls() {
      return statusBarCalls;
    },
    get statusReadCount() {
      return statusReadCount;
    },
  };
}

async function settle(turns = 6) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const { TimeTrackingStatusBarService } = await loadStatusBarService(false);
const { TimeTrackingStatusBarService: MobileTimeTrackingStatusBarService } = await loadStatusBarService(true);
const pluginStylesSource = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');

test('a burst of event-driven refreshes replays one authoritative status read', async () => {
  const firstRead = deferred();
  const harness = createHarness([firstRead.promise, pausedStatus('Newest paused timer')]);
  const service = new TimeTrackingStatusBarService(harness.plugin);

  service.setup();
  await settle();
  assert.equal(harness.statusReadCount, 1);

  for (let index = 0; index < 100; index += 1) service.refresh();
  firstRead.resolve(activeStatus('Stale active timer'));
  await settle();

  assert.equal(harness.statusReadCount, 2, '100 overlaps should coalesce into one trailing status read');
  assert.match(harness.statusItems[0].visibleText, /Newest paused timer/);
  assert.doesNotMatch(harness.statusItems[0].visibleText, /Stale active timer/);
});

test('a queued refresh hides a timer that stopped during an in-flight read', async () => {
  const firstRead = deferred();
  const harness = createHarness([firstRead.promise, { active: null, paused: null }]);
  const service = new TimeTrackingStatusBarService(harness.plugin);

  service.setup();
  await settle();
  service.refresh();
  firstRead.resolve(activeStatus());
  await settle();

  assert.equal(harness.statusReadCount, 2);
  assert.equal(harness.statusItems[0].style.display, 'none');
  assert.equal(harness.statusItems[0].visibleText, '');
});

test('periodic setup overlap does not add a redundant trailing full status read', async () => {
  const firstRead = deferred();
  const harness = createHarness([firstRead.promise]);
  const service = new TimeTrackingStatusBarService(harness.plugin);

  service.setup();
  await settle();
  assert.equal(harness.intervalCallbacks.length, 2);
  harness.intervalCallbacks[1]();
  firstRead.resolve(activeStatus());
  await settle();

  assert.equal(harness.statusReadCount, 1);
});

test('a failed status read cannot discard an already queued refresh', async () => {
  const firstRead = deferred();
  const harness = createHarness([firstRead.promise, pausedStatus('Recovered timer')]);
  const service = new TimeTrackingStatusBarService(harness.plugin);

  service.setup();
  await settle();
  service.refresh();
  firstRead.reject(new Error('synthetic status read failure'));
  await settle();

  assert.equal(harness.statusReadCount, 2);
  assert.match(harness.statusItems[0].visibleText, /Recovered timer/);
});

test('detach prevents stale work from mutating a removed or replacement status item', async () => {
  const firstRead = deferred();
  const harness = createHarness([firstRead.promise, pausedStatus('Replacement timer')]);
  const service = new TimeTrackingStatusBarService(harness.plugin);

  service.setup();
  await settle();
  const removedItem = harness.statusItems[0];
  service.detach();
  service.setup();
  await settle();
  const replacementItem = harness.statusItems[1];

  firstRead.resolve(activeStatus('Detached timer'));
  await settle();

  assert.equal(harness.statusReadCount, 2);
  assert.equal(removedItem.visibleText, '');
  assert.match(replacementItem.visibleText, /Replacement timer/);
  assert.doesNotMatch(replacementItem.visibleText, /Detached timer/);
});

test('successful timer actions do not request a third redundant status scan', async () => {
  const secondRead = deferred();
  const harness = createHarness([
    activeStatus('Action timer'),
    secondRead.promise,
  ]);
  const service = new TimeTrackingStatusBarService(harness.plugin);
  harness.plugin.timeTrackingService.pauseActiveTimer = async () => {
    service.refresh();
    return { id: 'session-1' };
  };

  service.setup();
  await settle();
  const actionButton = harness.statusItems[0].children[0].children[2];
  const clickPromise = actionButton.listeners.get('click')({
    preventDefault() {},
    stopPropagation() {},
  });
  await settle();
  assert.equal(harness.statusReadCount, 2);

  secondRead.resolve(pausedStatus('Action paused'));
  await clickPromise;
  await settle();

  assert.equal(harness.statusReadCount, 2);
});

test('mobile mounts one in-flow timer dock without calling the unsupported status-bar API', async () => {
  const harness = createHarness([activeStatus('Mobile timer')]);
  const service = new MobileTimeTrackingStatusBarService(harness.plugin);

  service.setup();
  await settle();

  assert.equal(harness.statusBarCalls, 0);
  assert.equal(harness.createdElements.length, 1);
  const dock = harness.createdElements[0];
  assert.equal(dock.parentElement, harness.leafContainer);
  assert.equal(dock.nextElementSibling, harness.viewContent);
  assert.match(dock.visibleText, /Mobile timer/);
  assert.equal(dock.classes.has('tps-gcm-time-tracker-mobile-dock'), true);

  await dock.children[0].children[0].listeners.get('click')();
  assert.equal(harness.plugin.openedNotes, 1, 'the mobile primary action opens the Daily Note workspace');
});

test('mobile reparents the same timer dock when the active leaf changes', async () => {
  const harness = createHarness([activeStatus('Moving timer')]);
  const service = new MobileTimeTrackingStatusBarService(harness.plugin);
  service.setup();
  await settle();
  const dock = harness.createdElements[0];

  const nextLeaf = new FakeElement('next-leaf');
  const nextContent = new FakeElement('next-content');
  nextContent.addClass('view-content');
  nextLeaf.appendChild(nextContent);
  harness.plugin.app.workspace.activeLeaf = {
    containerEl: nextLeaf,
    view: { containerEl: nextContent },
  };
  harness.workspaceHandlers.get('active-leaf-change')();

  assert.equal(harness.createdElements.length, 1);
  assert.equal(dock.parentElement, nextLeaf);
  assert.equal(dock.nextElementSibling, nextContent);
  assert.equal(harness.leafContainer.children.includes(dock), false);
});

test('mobile hides the dock when no active or paused timer exists', async () => {
  const harness = createHarness([{ active: null, paused: null }]);
  const service = new MobileTimeTrackingStatusBarService(harness.plugin);
  service.setup();
  await settle();

  const dock = harness.createdElements[0];
  assert.equal(dock.style.display, 'none');
  assert.equal(dock.visibleText, '');
});

test('mobile timer CSS is namespaced, in-flow, and keeps usable touch targets', () => {
  const start = pluginStylesSource.indexOf('body.is-mobile .tps-gcm-time-tracker-mobile-dock');
  const end = pluginStylesSource.indexOf('/* Mobile gesture passthrough', start);
  const css = pluginStylesSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(css, /position: relative/);
  assert.match(css, /min-height: 40px/);
  assert.match(css, /safe-area-inset-left/);
  assert.doesNotMatch(css, /position: fixed/);
});
