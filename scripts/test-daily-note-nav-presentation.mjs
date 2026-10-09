import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setMaxListeners } from 'node:events';
import ts from 'typescript';

const managerSource = readFileSync(new URL('../src/handlers/daily-note-nav-manager.ts', import.meta.url), 'utf8');
const daySource = readFileSync(new URL('../src/utils/daily-note-nav-days.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/plugin-styles.ts', import.meta.url), 'utf8');

function transpile(source, imports = {}) {
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  new Function('exports', 'module', 'require', output)(module.exports, module, name => {
    if (name in imports) return imports[name];
    throw Error(`Unexpected import ${name}`);
  });
  return module.exports;
}

class EventTargetFacade {
  listeners = new Map();
  addEventListener(name, callback, options) {
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(callback);
    this.listeners.set(name, listeners);
    if (options?.signal) {
      setMaxListeners(0, options.signal);
      options.signal.addEventListener('abort', () => listeners.delete(callback), { once: true });
    }
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  dispatch(name) { for (const callback of [...(this.listeners.get(name) ?? [])]) callback({ type: name }); }
}

class Element extends EventTargetFacade {
  constructor(tag, ownerDocument) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.className = '';
    this.isConnected = true;
    this.style = { removeProperty() {}, setProperty() {} };
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: name => this.addClass(name),
      remove: name => this.removeClass(name),
    };
  }
  addClass(name) { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), name])].join(' '); }
  removeClass(name) { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' '); }
  toggleClass(name, enabled) { enabled ? this.addClass(name) : this.removeClass(name); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) { child.parentElement = this; child.isConnected = this.isConnected; this.children.push(child); return child; }
  insertBefore(child) { return this.appendChild(child); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.isConnected = false;
  }
  createEl(tag, options = {}) {
    const child = this.ownerDocument.createElement(tag);
    child.className = options.cls ?? '';
    child.textContent = options.text ?? '';
    for (const [name, value] of Object.entries(options.attr ?? {})) child.setAttribute(name, value);
    return this.appendChild(child);
  }
  createDiv(options = {}) { return this.createEl('div', options); }
  all(className) {
    return this.children.flatMap(child => [
      ...(child.classList.contains(className) ? [child] : []),
      ...child.all(className),
    ]);
  }
}

class Component {
  disposers = [];
  registerEvent(event) { this.disposers.push(() => event.off?.()); return event; }
  registerDomEvent(target, name, callback, options) {
    target.addEventListener(name, callback, options);
    this.disposers.push(() => target.removeEventListener(name, callback));
  }
  register(callback) { this.disposers.push(callback); }
  unload() { this.onunload?.(); for (const dispose of this.disposers.splice(0)) dispose(); }
}

class TFile { constructor(path) { this.path = path; this.basename = path.split('/').pop().replace(/\.md$/, ''); } }
class MarkdownView {}
const { DailyNoteNavManager } = transpile(managerSource, {
  obsidian: { Component, TFile, MarkdownView, Modal: class {}, App: class {}, setIcon() {}, Notice: class {}, Platform: {} },
  '../logger': { error() {}, warn() {} },
  '../services/leaf-resolver': { isStrictSourceMode: () => false },
  '../utils/daily-note-nav-days': transpile(daySource),
  '../utils/daily-note-task-schedule': { parseDailyNoteFileDate: (_app, _settings, file) => file.basename },
});

function clockMoment(clock, value) {
  const date = value === undefined ? new Date(clock.now) : value instanceof Date
    ? new Date(value) : typeof value === 'number' ? new Date(value) : new Date(`${String(value).slice(0, 10)}T12:00:00`);
  const result = {
    isValid: () => !Number.isNaN(date.getTime()),
    clone: () => clockMoment(clock, date),
    valueOf: () => date.getTime(),
    toDate: () => new Date(date),
    diff(other) { return date.getTime() - Number(other); },
    isoWeekday: () => date.getDay() || 7,
    startOf(unit) { if (unit === 'day') date.setHours(0, 0, 0, 0); return result; },
    endOf(unit) { if (unit === 'day') date.setHours(23, 59, 59, 999); return result; },
    add(amount, unit) {
      if (unit === 'day' || unit === 'days') date.setDate(date.getDate() + amount);
      else date.setTime(date.getTime() + amount);
      return result;
    },
    format(format) {
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      if (format === 'YYYY-MM-DD') return iso;
      if (format === 'ddd D') return `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${date.getDate()}`;
      return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    },
  };
  return result;
}

function fixture({ opened = '2026-10-08', today = '2026-10-09', dayCount = 0, mobile = false } = {}) {
  const stats = { creates: 0, reads: 0, writes: 0, scans: 0, schedules: 0 };
  const clock = { now: new Date(`${today}T12:00:00`).getTime() };
  const document = new EventTargetFacade();
  document.hidden = false;
  document.visibilityState = 'visible';
  document.createElement = tag => { stats.creates++; return new Element(tag, document); };
  document.querySelectorAll = () => [];
  document.body = new Element('body', document);
  const window = new EventTargetFacade();
  window.moment = value => clockMoment(clock, value);
  window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  window.document = document;
  document.defaultView = window;
  const timers = new Map();
  let nextTimer = 0;
  const setTimeout = (callback, delay) => {
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  };
  const clearTimeout = id => timers.delete(id);
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  const saved = new Map();
  for (const [name, value] of Object.entries({ window, document, HTMLElement: Element, setTimeout, clearTimeout })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const savedDateNow = Date.now;
  Date.now = () => clock.now;
  const host = new Element('div', document);
  const content = new Element('div', document);
  const file = new TFile(`Daily/${opened}.md`);
  const leaf = { view: { file, contentEl: content, containerEl: host }, containerEl: host, getViewState: () => ({ type: 'markdown' }) };
  const events = new EventTargetFacade();
  const plugin = {
    settings: { enableDailyNoteNav: true, dailyNavDayCount: dayCount, dailyNavShowToday: true },
    fileNamingService: { getDailyNoteConfigurationSnapshot: () => ({ format: 'YYYY-MM-DD' }) },
    app: {
      workspace: {
        activeLeaf: leaf,
        on(name, callback) { events.addEventListener(name, callback); return { off: () => events.removeEventListener(name, callback) }; },
        onLayoutReady() {},
        getLeavesOfType: () => [leaf],
      },
      vault: {
        read() { stats.reads++; assert.fail('Daily navigation display must not read note bodies'); },
        cachedRead() { stats.reads++; assert.fail('Daily navigation display must not read note bodies'); },
        modify() { stats.writes++; assert.fail('Daily navigation display must not modify notes'); },
        getMarkdownFiles() { stats.scans++; assert.fail('Daily navigation display must not inventory the vault'); },
      },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    },
    overlayRenderingService: { scheduleDailyNavRefresh() { stats.schedules++; } },
  };
  const manager = new DailyNoteNavManager(plugin);
  manager.resolveMobileBottomNavPlacement = () => mobile ? { host, before: null } : null;
  manager.resolveHeaderNavHost = () => host;
  manager.resolveTitleAnchor = () => null;
  manager.removeStrayMobileNavs = () => {};
  manager.isMobileLayout = () => mobile;
  const originalInject = manager.injectNav;
  let renders = 0;
  manager.injectNav = function (...args) { renders++; return originalInject.apply(this, args); };
  return {
    manager, plugin, leaf, events, stats, clock, document, window, timers,
    renders: () => renders,
    days: () => manager.currentNav?.all('tps-daily-nav-day') ?? [],
    fireTimer(id) { const timer = timers.get(id); assert.ok(timer, `Missing timer ${id}`); timers.delete(id); timer.callback(); },
    advanceTo(iso) { clock.now = new Date(`${iso}T12:00:00`).getTime(); },
    close() {
      manager.unload();
      Date.now = savedDateNow;
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
      }
    },
  };
}

function run(options, callback) {
  const f = fixture(options);
  try { callback(f); } finally { f.close(); }
}

test('opening Thursday centers Thursday while Friday remains the current-date highlight', () => run({}, f => {
  f.manager.refresh();
  const days = f.days();
  assert.deepEqual(days.map(day => day.textContent), ['Tue 6', 'Wed 7', 'Thu 8', 'Fri 9', 'Sat 10']);
  assert.equal(f.manager.currentNav.dataset.dayCount, 'auto');
  assert.deepEqual(days.map(day => day.dataset.offset), ['-2', '-1', '0', '1', '2']);
  assert.deepEqual(days.filter(day => day.classList.contains('is-active')).map(day => day.textContent), ['Thu 8']);
  assert.deepEqual(days.filter(day => day.classList.contains('is-today')).map(day => day.textContent), ['Fri 9']);
  assert.equal(days[2].getAttribute('aria-pressed'), 'true');
  assert.notEqual(days[2].getAttribute('aria-current'), 'date');
  assert.equal(days[3].getAttribute('aria-current'), 'date');
  assert.equal(days[3].getAttribute('aria-pressed'), 'false');
  assert.equal(f.stats.reads + f.stats.writes + f.stats.scans, 0);
}));

test('future daily notes keep actual today highlighted and do not invent a current date outside the strip', () => {
  run({ opened: '2026-10-10' }, f => {
    f.manager.refresh();
    assert.equal(f.days().filter(day => day.classList.contains('is-today'))[0]?.textContent, 'Fri 9');
    assert.equal(f.days()[2].textContent, 'Sat 10');
  });
  run({ opened: '2026-11-10' }, f => {
    f.manager.refresh();
    assert.equal(f.days().filter(day => day.classList.contains('is-today')).length, 0);
    assert.equal(f.days().filter(day => day.getAttribute('aria-current') === 'date').length, 0);
    assert.equal(f.manager.currentNav.all('tps-daily-nav-today').length, 1);
  });
});

test('explicit counts remain configured and the opened day stays centered across week and month boundaries', () => {
  for (const count of [1, 3, 5, 7]) run({ opened: '2026-11-01', dayCount: count }, f => {
    f.manager.refresh();
    assert.equal(f.days().length, count);
    assert.equal(f.manager.currentNav.dataset.dayCount, String(count));
    assert.equal(f.days()[Math.floor(count / 2)].textContent, 'Sun 1');
  });
});

test('100 unchanged refreshes reuse the mounted strip without body I/O, scans, renders or timer churn', () => run({}, f => {
  f.manager.refresh();
  const originalNav = f.manager.currentNav;
  const originalTimer = f.manager._todayRefreshTimer;
  const creates = f.stats.creates;
  for (let index = 0; index < 100; index++) f.manager.refresh();
  assert.equal(f.manager.currentNav, originalNav);
  assert.equal(f.manager._todayRefreshTimer, originalTimer);
  assert.equal(f.stats.creates, creates);
  assert.equal(f.renders(), 1);
  assert.equal(f.stats.reads + f.stats.writes + f.stats.scans, 0);
  assert.equal(f.timers.size, 1);
}));

test('an open daily note updates its current-date highlight after the owned midnight callback', () => run({}, f => {
  f.manager.refresh();
  const oldNav = f.manager.currentNav;
  const id = f.manager._todayRefreshTimer;
  assert.ok(f.timers.get(id)?.delay > 0);
  assert.ok(f.timers.get(id)?.delay <= 86_400_000 + 1_000);
  f.advanceTo('2026-10-10');
  f.fireTimer(id);
  // The established overlay queue remains the render owner if the callback coalesces through it.
  if (f.stats.schedules) f.manager.refresh();
  assert.notEqual(f.manager.currentNav, oldNav);
  assert.equal(f.manager._currentTodayIso, '2026-10-10');
  assert.deepEqual(f.days().filter(day => day.classList.contains('is-today')).map(day => day.textContent), ['Sat 10']);
  assert.equal(f.days()[2].textContent, 'Thu 8');
  assert.equal(f.timers.size, 1);
  assert.equal(f.stats.reads + f.stats.writes + f.stats.scans, 0);
}));

test('midnight scheduling follows local calendar boundaries across daylight-saving transition dates', () => {
  for (const [today, tomorrow] of [['2026-03-08', '2026-03-09'], ['2026-11-01', '2026-11-02']]) {
    run({ today, opened: today }, f => {
      f.clock.now = new Date(`${today}T00:30:00`).getTime();
      f.manager.refresh();
      const expected = new Date(`${tomorrow}T00:00:00`).getTime() - f.clock.now;
      assert.equal(f.timers.get(f.manager._todayRefreshTimer).delay, expected);
      assert.equal(f.timers.size, 1);
      assert.equal(f.stats.reads + f.stats.writes + f.stats.scans, 0);
    });
  }
});

test('foreground and visible-resume events use the established refresh owner and clean up on unload', () => run({}, f => {
  f.manager.onload();
  assert.ok(f.window.listeners.get('focus')?.size, 'Component owns a focus handler');
  assert.ok(f.document.listeners.get('visibilitychange')?.size, 'Component owns a visibility handler');
  const initial = f.stats.schedules;
  f.window.dispatch('focus');
  assert.equal(f.stats.schedules, initial + 1);
  f.document.visibilityState = 'hidden';
  f.document.hidden = true;
  f.document.dispatch('visibilitychange');
  assert.equal(f.stats.schedules, initial + 1, 'Hidden tabs must not request foreground rendering');
  f.document.visibilityState = 'visible';
  f.document.hidden = false;
  f.document.dispatch('visibilitychange');
  assert.equal(f.stats.schedules, initial + 2);
  const callbacks = [...f.timers.values()].map(timer => timer.callback);
  const focus = [...f.window.listeners.get('focus')][0];
  f.manager.unload();
  assert.equal(f.timers.size, 0);
  assert.equal(f.manager.currentNav, null);
  const schedules = f.stats.schedules;
  for (const callback of callbacks) callback();
  focus();
  f.manager.refresh();
  assert.equal(f.manager.currentNav, null);
  assert.equal(f.stats.schedules, schedules, 'Captured callbacks cannot schedule work after unload');
  assert.equal(f.window.listeners.get('focus')?.size ?? 0, 0);
  assert.equal(f.document.listeners.get('visibilitychange')?.size ?? 0, 0);
}));

test('detaching the date strip clears its midnight timeout and rejects an already queued callback', () => run({}, f => {
  f.manager.refresh();
  const callback = f.timers.get(f.manager._todayRefreshTimer).callback;
  f.plugin.settings.enableDailyNoteNav = false;
  f.manager.refresh();
  assert.equal(f.manager.currentNav, null);
  assert.equal(f.manager._todayRefreshTimer, null);
  assert.equal(f.timers.size, 0);
  const schedules = f.stats.schedules;
  callback();
  assert.equal(f.manager.currentNav, null);
  assert.equal(f.stats.schedules, schedules, 'A detached nav owns no date refresh');
}));

test('mobile presentation mounts the date row with the same opened and actual-today semantics', () => run({ mobile: true }, f => {
  f.manager.refresh();
  assert.ok(f.manager.currentNav.classList.contains('tps-daily-note-nav--mobile-bottom'));
  assert.equal(f.days().length, 5);
  assert.equal(f.days()[2].textContent, 'Thu 8');
  assert.equal(f.days()[3].getAttribute('aria-current'), 'date');
}));

function rulesFor(selector) {
  const css = styles.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some(value => value.trim() === selector))
    .map(([, , declarations]) => declarations);
}

test('today styling follows Appearance accent, keeps opened-date styling separate and exposes mobile date rows', () => {
  const todayRules = rulesFor('.tps-daily-nav-day.is-today');
  assert.ok(todayRules.some(rule => /background[^;]*var\(--interactive-accent\)/.test(rule)));
  assert.ok(todayRules.every(rule => !rule.includes('--color-purple')));
  const actionRules = rulesFor('.tps-daily-nav-today');
  assert.ok(actionRules.some(rule => /background[^;]*var\(--interactive-accent\)/.test(rule)), 'Today action uses accent even away from today');
  assert.ok(rulesFor('.tps-daily-nav-day.is-active').every(rule => !/background[^;]*var\(--interactive-accent\)/.test(rule)));
  const mobileTimelineRules = rulesFor('.tps-daily-note-nav--mobile-bottom .tps-daily-nav-timeline');
  assert.ok(mobileTimelineRules.length > 0);
  assert.ok(mobileTimelineRules.every(rule => !/display:\s*none\b/.test(rule)), 'Mobile must keep the date strip visible');
  assert.ok(rulesFor('.tps-daily-note-nav--mobile-bottom').every(rule => !/flex-direction:\s*column-reverse/.test(rule)), 'The opened date remains above Today');
});

test('Automatic date count contracts symmetrically with container space without a resize observer', () => {
  assert.ok(/container-type:\s*inline-size/.test(styles) || /container:\s*tps-daily-nav\s*\/\s*inline-size/.test(styles), 'Navigation owns an inline-size query container');
  assert.ok(/@container\s+tps-daily-nav/.test(styles), 'Responsive queries are scoped to the navigation container');
  assert.ok(/data-day-count[=\s"']+auto/.test(styles));
  for (const offset of [-2, -1, 1, 2]) assert.ok(styles.includes(`[data-offset="${offset}"]`), `Responsive pair ${offset} is represented`);
  assert.doesNotMatch(managerSource, /new ResizeObserver/);
});

test('Automatic cells retain equal scaled border-box widths after mobile defaults', () => {
  const selector = '.tps-daily-note-nav[data-day-count="auto"] .tps-daily-nav-day';
  const cellRule = rulesFor(selector).at(-1);
  assert.ok(cellRule, 'Automatic has its own cell sizing rule');
  assert.match(cellRule, /box-sizing:\s*border-box/);
  assert.match(cellRule, /font-size:\s*1em/);
  assert.match(cellRule, /width:\s*4\.6667em/);
  assert.match(cellRule, /flex:\s*0\s+0\s+4\.6667em/);
  assert.match(cellRule, /min-width:\s*0/);
  assert.match(cellRule, /padding-inline:\s*0\.3333em/);
  assert.ok(
    styles.lastIndexOf(selector + ' {') > styles.lastIndexOf('.is-phone .tps-daily-note-nav--mobile-bottom .tps-daily-nav-day'),
    'Equal-specificity mobile defaults must precede the scaled Automatic sizing rule',
  );
  const navRule = rulesFor('.tps-daily-note-nav').at(-1);
  assert.match(navRule, /font-size:\s*calc\(12px\s*\*\s*var\(--tps-gcm-daily-nav-scale\)\)/);
  assert.ok(/width:\s*(?:min\(|calc\(|[\d.]+(?:px|%))/.test(navRule), 'Inline-size containment needs a defined nav width');
});

test('under-title and floating placements center the date strip over the Today controls', () => {
  const fallback = rulesFor('.tps-daily-note-nav--under-title').at(-1);
  assert.match(fallback, /align-items:\s*center/);
  assert.match(fallback, /width:\s*100%/);
  const floating = rulesFor('.tps-daily-note-nav--floating').at(-1);
  assert.match(floating, /left:\s*50%/);
  assert.match(floating, /transform:\s*translateX\(-50%\)/);
  const desktopFloating = rulesFor('body:not(.is-mobile):not(.is-phone) .tps-daily-note-nav--floating').at(-1);
  assert.match(desktopFloating, /pointer-events:\s*none/);
  assert.ok(
    styles.lastIndexOf('body:not(.is-mobile):not(.is-phone) .tps-daily-note-nav--floating {')
      > styles.lastIndexOf('body:not(.is-mobile):not(.is-phone) .tps-daily-note-nav {'),
    'Floating passthrough must override the equal-specificity desktop nav hit surface',
  );
  const floatingButtons = rulesFor('body:not(.is-mobile):not(.is-phone) .tps-daily-note-nav--floating button').at(-1);
  assert.match(floatingButtons, /pointer-events:\s*auto/);
  assert.ok(
    !rulesFor('body:not(.is-mobile):not(.is-phone) .tps-daily-note-nav--floating .tps-daily-nav-controls')
      .some(rule => /pointer-events:\s*auto/.test(rule)),
    'Full-width floating control wrappers must not capture empty-area clicks',
  );
  assert.match(rulesFor('.tps-daily-nav-controls').at(-1), /width:\s*100%/);
  assert.ok(rulesFor('.tps-daily-nav-controls').some(rule => /justify-content:\s*center/.test(rule)));
});
