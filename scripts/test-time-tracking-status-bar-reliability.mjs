import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function loadStatusBarService() {
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
  }

  empty() {
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

function createHarness(statusResults) {
  const intervalCallbacks = [];
  const statusItems = [];
  let statusReadCount = 0;
  const plugin = {
    settings: { enableTimeTracking: true },
    addStatusBarItem() {
      const item = new FakeElement(`status-${statusItems.length + 1}`);
      statusItems.push(item);
      return item;
    },
    registerInterval() {},
    app: {
      workspace: {
        onLayoutReady(callback) {
          plugin.layoutReadyCallback = callback;
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
      async openPausedTimerTarget() {
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

  globalThis.document = { querySelector: () => null };
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

const { TimeTrackingStatusBarService } = await loadStatusBarService();

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
