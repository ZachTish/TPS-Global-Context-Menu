import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const srcRoot = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = `${directory}/${name}`;
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

test('every TPS Modal opts into the shared mobile input contract', () => {
  const missing = sourceFiles(srcRoot)
    .filter((path) => readFileSync(path, 'utf8').includes('extends Modal'))
    .filter((path) => !readFileSync(path, 'utf8').includes("modalEl.addClass('mod-tps-gcm"))
    .filter((path) => !readFileSync(path, 'utf8').includes('modalEl.addClass("mod-tps-gcm'));
  assert.deepEqual(missing, []);
});

test('remaining task popup card uses the shared keyboard-aware overlay', () => {
  const taskEditor = readFileSync(`${srcRoot}/services/task-line-context-menu-service.ts`, 'utf8');
  const notePreview = readFileSync(`${srcRoot}/menu/persistent-menu-manager.ts`, 'utf8');
  const mobileOverlay = readFileSync(`${srcRoot}/utils/mobile-overlay.ts`, 'utf8');
  assert.match(taskEditor, /new KeyboardAwareOverlay\(card, anchorEl/);
  assert.doesNotMatch(notePreview, /new KeyboardAwareOverlay\(popover, anchorEl/);
  assert.match(mobileOverlay, /NATIVE_KEYBOARD_SHOW_EVENTS = \['keyboardWillShow', 'keyboardDidShow'\]/);
  assert.match(mobileOverlay, /this\.targetWindow\.addEventListener\('keyboardDidHide', this\.keyboardDidHideHandler\)/);
  assert.match(mobileOverlay, /this\.targetWindow\.removeEventListener\('keyboardDidHide', this\.keyboardDidHideHandler\)/);
  assert.match(mobileOverlay, /getVisibleViewport\(window, sharedNativeKeyboard\)/);
  assert.match(mobileOverlay, /resetNativeKeyboard\(sharedNativeKeyboard\);\s+const root = document\.documentElement\.style/);
  assert.match(mobileOverlay, /this\.targetDocument = element\.ownerDocument/);
  assert.match(mobileOverlay, /this\.targetWindow = this\.targetDocument\.defaultView \?\? window/);
  assert.match(mobileOverlay, /this\.targetWindow\.visualViewport\?\.addEventListener\('resize'/);
  assert.match(mobileOverlay, /getVisibleViewport\(this\.targetWindow, sharedNativeKeyboard\)/);
  assert.match(mobileOverlay, /this\.targetDocument\.body\.classList\.contains\('is-mobile'\)/);
  assert.match(mobileOverlay, /this\.targetWindow\.visualViewport\?\.removeEventListener\('resize'/);
});

test('existing TPS plugin modal files opt into the shared mobile contract', () => {
  const pluginRoots = [
    '../../TPS-Calendar-Base (Dev)/src',
    '../../TPS-Controller (Dev)/src',
    '../../TPS-Finances (Dev)/src',
    '../../TPS-health (Dev)/src',
    '../../tps-messager/src',
  ].map((path) => fileURLToPath(new URL(path, import.meta.url)));
  const missing = pluginRoots.flatMap(sourceFiles)
    .filter((path) => /extends Modal|new Modal\(/.test(readFileSync(path, 'utf8')))
    .filter((path) => !readFileSync(path, 'utf8').includes('tps-keyboard-aware-modal'));
  assert.deepEqual(missing, []);
  const healthSource = readFileSync(fileURLToPath(new URL('../../TPS-health (Dev)/src/main.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(healthSource, /setupKeyboardAwareHealthModal/);
  assert.match(readFileSync(`${srcRoot}/utils/mobile-overlay.ts`, 'utf8'), /target\.scrollIntoView/);
});

// Compile unchanged production methods; mock only the host/DOM boundaries.
// Counts below are not browser timings or physical mobile acceptance.
function mobileMethods(path, names) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const methods = new Map();
  const visit = node => {
    if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(source))) {
      methods.set(node.name.getText(source), node.getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const name of names) assert.ok(methods.has(name), name);
  return names.map(name => methods.get(name)).join('\n');
}
const managerMethods = mobileMethods(srcRoot + '/menu/persistent-menu-manager.ts', [
  'ensureMenus', 'ensureReadingMenu', 'ensureLiveMenu', 'updateMobileBottomOffsets',
  'applyPersistentMenuGeometry', 'handleKeyboardVisibilityChange',
  'setupKeyboardDetection', 'teardownKeyboardDetection', 'isKeyboardSuppressionEnabled',
  'isMobileOverlayInteractionActive', 'isInsideMobileStableOverlay', 'markMobileOverlayInteraction',
]);
const embedMethods = mobileMethods(srcRoot + '/services/virtual-base-embed-service.ts', ['refreshView']);
const mobileModule = ts.transpileModule(
  'class Manager {' + managerMethods + '} class Embeds {' + embedMethods
    + '} exports.Manager=Manager; exports.Embeds=Embeds;',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;

function mobileHarness({ enabled = true, mobile = true, ordinaryNodes = 0 } = {}) {
  const counts = { inventories: 0, styles: 0, rects: 0, closest: 0, offsetWrites: 0 };
  const nodes = [], offsets = [], events = new Map(), viewportEvents = new Map(), windowEvents = new Map();
  const listenerCaptures = new WeakMap();
  const listen = registry => ({
    addEventListener(name, callback, options) {
      if (!registry.has(name)) registry.set(name, new Set());
      registry.get(name).add(callback);
      listenerCaptures.set(callback, typeof options === 'boolean' ? options : options?.capture === true);
    },
    removeEventListener(name, callback, options) {
      const capture = typeof options === 'boolean' ? options : options?.capture === true;
      assert.equal(capture, listenerCaptures.get(callback), 'removal must match the capture phase');
      registry.get(name)?.delete(callback);
    },
  });
  class Element {
    constructor(classes = [], options = {}) {
      this.classes = new Set(classes); this.children = []; this.dataset = {};
      this.isConnected = options.connected ?? true;
      this.style = { setProperty() {}, removeProperty() {} };
      this.computed = { display: 'block', visibility: 'visible', pointerEvents: 'auto', position: 'static', ...options.style };
      this.rect = { left: 12, top: 736, width: 400, height: 64, bottom: 800, ...options.rect };
      this.classList = { contains: name => this.classes.has(name), toggle() {}, remove() {}, add() {} };
      nodes.push(this);
    }
    closest(selector) {
      counts.closest++;
      return selector.split(',').some(part => this.classes.has(part.trim().slice(1))) ? this : null;
    }
    getBoundingClientRect() { counts.rects++; return this.rect; }
    toggleClass() {}
    appendChild(child) { child.isConnected = this.isConnected; this.children.push(child); }
    contains(child) { return this.children.includes(child); }
    querySelector() { return null; }
    remove() { this.isConnected = false; }
  }
  class TFile { constructor(path) { this.path = path; this.extension = 'md'; this.basename = path; } }
  class MarkdownView {}
  const isConsumer = node => node.isConnected && (
    node.classes.has('tps-gcm-virtual-base-embed--hover')
    || (!node.classes.has('tps-global-context-menu--mobile-pane')
      && (node.classes.has('tps-global-context-menu--reading') || node.classes.has('tps-global-context-menu--live')))
  );
  const document = {
    ...listen(events),
    body: { classList: { toggle() {}, remove() {} }, querySelectorAll(selector) {
      assert.equal(selector, '*'); counts.inventories++; return nodes;
    } },
    documentElement: { clientHeight: 800, style: { setProperty(key, value) {
      assert.equal(key, '--tps-gcm-mobile-toolbar-offset'); counts.offsetWrites++; offsets.push(value);
    } } },
    querySelector(selector) {
      assert.match(selector, /\.tps-gcm-virtual-base-embed--hover/u);
      assert.match(selector, /\.tps-global-context-menu--reading/u);
      assert.match(selector, /\.tps-global-context-menu--live/u);
      assert.match(selector, /:not\(\.tps-global-context-menu--mobile-pane\)/u);
      return nodes.find(isConsumer) ?? null;
    },
  };
  const window = {
    ...listen(windowEvents), innerHeight: 800,
    visualViewport: { height: 800, ...listen(viewportEvents) },
    getComputedStyle(node) { counts.styles++; return node.computed; },
    setTimeout() { return 1; }, clearTimeout() {},
  };
  const view = new MarkdownView(); view.file = new TFile('Inbox/Mobile offset.md'); view.mode = 'preview';
  const module = {};
  new Function('exports', 'Platform', 'document', 'window', 'HTMLElement', 'TFile', 'MarkdownView',
    'resolvePrimaryMarkdownView', 'isCompatibleMarkdownView', 'getViewMode', 'logger', mobileModule)(
    module, { isMobile: mobile }, document, window, Element, TFile, MarkdownView,
    () => view, candidate => candidate instanceof MarkdownView, candidate => candidate.mode,
    { error(error) { throw error; } },
  );
  const manager = new module.Manager();
  manager.plugin = { app: { workspace: {} }, settings: { enableInlinePersistentMenus: enabled } };
  for (const name of [
    'menus', 'inlineSubitemsPanels', 'noteReferencesPanels', 'noteGraphPanels', 'titleIcons',
    'topParentNavs', 'bottomParentNavs', 'linkedContextPanels', 'linkedContextRenders',
    'linkedContextHostObservers', 'topSurfaceHosts', 'liveResizeObservers',
  ]) manager[name] = new Map();
  for (const name of [
    'reconcileViewModeTransition', 'ensureReadingMenu', 'ensureLiveMenu', 'removeInlineSubitemsPanel',
    'removeNoteGraphPanel', 'removeNoteReferencesPanel', 'ensureInlineTitleIcon', 'ensureTopParentNav',
    'ensureLinkedContextPanel', 'removeGlobalStraysOutsideTarget', 'ensureBottomParentNav',
    'applyMenuVisibility', 'ensureSwipeGestureTracking', 'attachGeometryObserver', 'attachLiveHeightObserver',
    'removeStrayMenus', 'removeReadingMenu', 'removeLiveMenu',
  ]) manager[name] = () => {};
  manager.fileMatchesIgnoreRules = () => false; manager.isStrictSourceMode = () => false;
  manager.isMobileLayout = () => mobile; manager.shouldHideForKeyboard = () => false;
  manager.resolveMenuHostRect = () => ({ left: 0, width: 424 });
  manager.keyboardVisible = false; manager.editableFocused = false; manager.swipeCollapsed = false;
  manager.mobileOverlayInteractionUntil = 0; manager.keyboardFocusTimer = null;
  manager.mobileOverlayTouchStartHandler = null; manager.mobileOverlayPointerDownHandler = null;
  for (let index = 0; index < ordinaryNodes; index++) new Element();
  return { manager, module, counts, nodes, offsets, events, viewportEvents, windowEvents, window, Element, TFile, view };
}

for (const enabled of [false, true]) {
  test('unchanged mobile ensure bursts avoid full-document measurement; inline menus enabled=' + enabled, () => {
    const h = mobileHarness({ enabled, ordinaryNodes: 10000 });
    if (enabled) new h.Element(['tps-global-context-menu', 'tps-global-context-menu--reading', 'tps-global-context-menu--mobile-pane']);
    new h.Element(['tps-gcm-virtual-base-embed--hover'], { connected: false });
    for (let index = 0; index < 12; index++) h.manager.ensureMenus();
    assert.deepEqual(h.counts, { inventories: 0, styles: 0, rects: 0, closest: 0, offsetWrites: 0 });
  });
}

test('hover and fallback consumers retain current obstruction geometry and every exclusion', () => {
  for (const consumer of ['tps-gcm-virtual-base-embed--hover', 'tps-global-context-menu--reading', 'tps-global-context-menu--live']) {
    const h = mobileHarness(); new h.Element([consumer]);
    new h.Element([], { style: { position: 'fixed' } });
    new h.Element([], { style: { position: 'sticky' }, rect: { height: 89.1, top: 710.9 } });
    for (const excluded of ['tps-global-context-menu', 'tps-gcm-panel', 'tps-auto-base-embed', 'menu', 'modal']) {
      new h.Element([excluded], { style: { position: 'fixed' }, rect: { height: 250, top: 550 } });
    }
    for (const style of [{ display: 'none' }, { visibility: 'hidden' }, { pointerEvents: 'none' }, { position: 'absolute' }]) {
      new h.Element([], { style: { position: 'fixed', ...style }, rect: { height: 250, top: 550 } });
    }
    new h.Element([], { connected: false, style: { position: 'fixed' }, rect: { height: 250, top: 550 } });
    for (const rect of [{ height: 0 }, { height: NaN }, { bottom: 700 }, { top: 200, height: 500 }]) {
      new h.Element([], { style: { position: 'fixed' }, rect });
    }
    h.manager.updateMobileBottomOffsets(); h.manager.updateMobileBottomOffsets();
    assert.deepEqual(h.offsets, ['102px', '102px']);
    assert.equal(h.counts.inventories, 2, 'real consumers measure current geometry without a cache');
  }
});

test('keyboard transitions require a connected consumer and preserve zero-obstruction reset', () => {
  const h = mobileHarness(); h.manager.handleKeyboardVisibilityChange(true);
  assert.equal(h.counts.inventories, 0);
  const hover = new h.Element(['tps-gcm-virtual-base-embed--hover']);
  const toolbar = new h.Element([], { style: { position: 'fixed' } });
  h.manager.handleKeyboardVisibilityChange(true);
  toolbar.computed.display = 'none'; h.manager.handleKeyboardVisibilityChange(false);
  assert.deepEqual(h.offsets, ['76px', '0px']);
  hover.remove(); h.manager.handleKeyboardVisibilityChange(true);
  assert.equal(h.counts.inventories, 2);
});

test('desktop never inventories mobile obstruction geometry', () => {
  const h = mobileHarness({ mobile: false, ordinaryNodes: 10000 });
  new h.Element(['tps-gcm-virtual-base-embed--hover']); h.manager.updateMobileBottomOffsets();
  assert.deepEqual(h.counts, { inventories: 0, styles: 0, rects: 0, closest: 0, offsetWrites: 1 });
  assert.deepEqual(h.offsets, ['0px']);
});

for (const mode of ['reading', 'live']) {
  test('first ' + mode + ' fallback menu measures before geometry; mobile-pane mount does not', () => {
    for (const pane of [false, true]) {
      const h = mobileHarness(); h.view.mode = mode === 'reading' ? 'preview' : 'source';
      new h.Element([], { style: { position: 'fixed' } });
      const host = new h.Element(); h.view.contentEl = { querySelector: () => host };
      h.manager.resolveMobileMenuHost = () => pane ? host : null;
      h.manager.createPersistentMenu = () => new h.Element([
        'tps-global-context-menu', 'tps-global-context-menu--' + mode,
        ...(pane ? ['tps-global-context-menu--mobile-pane'] : []),
      ], { connected: false });
      const method = mode === 'reading' ? 'ensureReadingMenu' : 'ensureLiveMenu';
      const applyGeometry = h.manager.applyPersistentMenuGeometry.bind(h.manager);
      h.manager.applyPersistentMenuGeometry = (view, menu) => {
        assert.deepEqual(h.offsets, pane ? [] : ['76px'], 'first mount measures before positioning');
        applyGeometry(view, menu);
      };
      h.module.Manager.prototype[method].call(h.manager, h.view);
      const menu = h.manager.menus.get(h.view)[mode];
      assert.equal(h.counts.inventories, pane ? 0 : 1);
      assert.deepEqual(h.offsets, pane ? [] : ['76px']);
      assert.equal(menu.style.bottom, pane
        ? 'calc(58px + env(safe-area-inset-bottom, 0px))'
        : 'calc(max(var(--tps-auto-base-embed-bottom, var(--tps-gcm-live-bottom, 16px)), var(--tps-gcm-mobile-toolbar-offset, clamp(112px, 13vh, 176px))) + env(safe-area-inset-bottom, 0px) + var(--tps-auto-base-embed-height, 0px) + 8px)');
    }
  });
}

test('first hover mount/remount measures before async rendering; top/bottom embeds do not', async () => {
  for (const placement of ['hover', 'top', 'bottom']) {
    const h = mobileHarness(); new h.Element([], { style: { position: 'fixed' } });
    const embeds = new h.module.Embeds(); embeds.plugin = { persistentMenuManager: h.manager };
    embeds.mountedByView = new WeakMap();
    embeds.resolveTargetsByPlacement = () => ({ top: [], bottom: [], hover: [], [placement]: [new h.TFile('Inbox/View.base')] });
    const root = new h.Element();
    embeds.resolveRenderSurface = () => ({ root, mode: 'reading' });
    embeds.createHost = type => new h.Element(['tps-gcm-virtual-base-embed--' + type], { connected: false });
    embeds.insertTopHost = (surface, host) => surface.root.appendChild(host);
    embeds.findBottomInsertionTarget = () => root;
    embeds.clearView = () => { for (const mount of embeds.mountedByView.get(h.view) ?? []) mount.host.remove(); };
    embeds.installHostRemovalWatcher = () => {};
    let renders = 0;
    embeds.renderHost = async host => {
      renders++; assert.equal(host.isConnected, true);
      assert.equal(h.counts.inventories, placement === 'hover' ? renders : 0, 'measurement precedes async render');
      return { host };
    };
    await embeds.refreshView(h.view); await embeds.refreshView(h.view);
    assert.equal(renders, 2);
    assert.deepEqual(h.offsets, placement === 'hover' ? ['76px', '76px'] : []);
  }
});

test('mobile keyboard teardown removes touch/pointer callbacks across repeated reloads', () => {
  const h = mobileHarness(); const target = new h.Element(['tps-gcm-panel']);
  for (let iteration = 0; iteration < 5; iteration++) {
    h.manager.setupKeyboardDetection();
    for (const type of ['touchstart', 'pointerdown']) {
      assert.equal(h.events.get(type).size, 1);
      h.manager.mobileOverlayInteractionUntil = 0;
      for (const callback of h.events.get(type)) callback({ target });
      assert.ok(h.manager.mobileOverlayInteractionUntil > Date.now());
    }
    h.manager.teardownKeyboardDetection();
    for (const registry of [h.events, h.viewportEvents, h.windowEvents]) {
      for (const [name, callbacks] of registry) assert.equal(callbacks.size, 0, 'retained ' + name);
    }
    assert.equal(h.manager.mobileOverlayTouchStartHandler, null);
    assert.equal(h.manager.mobileOverlayPointerDownHandler, null);
    h.manager.mobileOverlayInteractionUntil = 0;
    for (const callback of h.events.get('touchstart')) callback({ target });
    assert.equal(h.manager.mobileOverlayInteractionUntil, 0);
  }
});
