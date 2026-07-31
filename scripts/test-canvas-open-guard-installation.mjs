import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const sourceRoot = process.env.TPS_GCM_CANVAS_GUARD_SOURCE_ROOT
  ? resolve(process.env.TPS_GCM_CANVAS_GUARD_SOURCE_ROOT)
  : fileURLToPath(new URL('..', import.meta.url));
const expectation = process.env.TPS_GCM_CANVAS_GUARD_EXPECTATION || 'candidate';
assert.ok(['released', 'candidate'].includes(expectation), `Unknown expectation: ${expectation}`);

const mainSource = readFileSync(resolve(sourceRoot, 'src/main.ts'), 'utf8');
const constantsSource = readFileSync(resolve(sourceRoot, 'src/constants.ts'), 'utf8');
if (expectation === 'released') {
  assert.equal(
    createHash('sha256').update(mainSource).digest('hex'),
    '502e0a6ca56c58830032acc57dee7ea4451087a3e68f962efe1f9fb1093947f5',
    'released comparison must use the exact 1.11.9 main source',
  );
}
const sourceFile = ts.createSourceFile(
  'main.ts',
  mainSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function extractMethod(name) {
  let match = null;
  const visit = (node) => {
    if (ts.isMethodDeclaration(node) && node.name?.getText(sourceFile) === name) {
      match = node.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(match, `Missing ${name} in ${sourceRoot}`);
  return match;
}

const shouldInstallMethod = extractMethod('shouldInstallWorkspaceOpenPatch');
const shouldSuppressMethod = extractMethod('shouldSuppressOpenForRecentCanvasDrag');
const installMethod = extractMethod('installCanvasOpenGuard');

const virtualSource = `
const logger = { log() {}, warn() {} };
const window = { setTimeout(callback) { callback(); return 1; } };

export class TFile {
  constructor(public path: string) {}
}

export class WorkspaceLeaf {
  view = { kind: 'native-view' };
  constructor(private stats: any) {}
  openFile(...args: any[]) {
    this.stats.calls.push({ name: 'leaf.openFile', receiver: this, args });
    return Promise.resolve('native-open-file');
  }
  open(...args: any[]) {
    this.stats.calls.push({ name: 'leaf.open', receiver: this, args });
    return Promise.resolve(this.view);
  }
  setViewState(...args: any[]) {
    this.stats.calls.push({ name: 'leaf.setViewState', receiver: this, args });
    return Promise.resolve(args[0]);
  }
  getViewState() {
    return { state: { file: 'Active.md' } };
  }
}

export const workspaceMethodNames = [
  'getLeaf',
  'getUnpinnedLeaf',
  'getRightLeaf',
  'getLeftLeaf',
  'createLeafBySplit',
  'createLeafInParent',
  'splitActiveLeaf',
  'duplicateLeaf',
  'openPopoutLeaf',
  'openLinkText',
];

export const leafMethodNames = ['openFile', 'open', 'setViewState'];

export class GuardHarness {
  recentCanvasDragUntil = 0;
  guardChecks = 0;
  deadBaseChecks = 0;
  cleanup: () => void = () => {};

  constructor(public settings: any, public app: any) {}

  private shouldAllowNativeBaseLinkOpen(_file: TFile): boolean {
    this.deadBaseChecks += 1;
    return true;
  }

  private interceptNativeBaseLinkOpen(_file: TFile, _leaf: WorkspaceLeaf): boolean {
    this.deadBaseChecks += 1;
    return false;
  }

  ${shouldInstallMethod}
  ${shouldSuppressMethod}
  ${installMethod}

  start(): boolean {
    const originalGuard = this.shouldSuppressOpenForRecentCanvasDrag.bind(this);
    this.shouldSuppressOpenForRecentCanvasDrag = () => {
      this.guardChecks += 1;
      return originalGuard();
    };
    const decision = this.shouldInstallWorkspaceOpenPatch();
    this.cleanup = decision ? this.installCanvasOpenGuard() : () => {};
    return decision;
  }
}

export function createEnvironment(enabled: boolean, omitUnpinned = false, inherited = false) {
  const stats = { assignments: [], calls: [] };
  const leaf = new WorkspaceLeaf(stats);
  let workspace;
  const record = (name, receiver, args, result) => {
    stats.calls.push({ name, receiver, args });
    return result;
  };
  const workspaceMethods: any = {
    getLeaf(...args: any[]) { return record('getLeaf', this, args, leaf); },
    getRightLeaf(...args: any[]) { return record('getRightLeaf', this, args, leaf); },
    getLeftLeaf(...args: any[]) { return record('getLeftLeaf', this, args, leaf); },
    createLeafBySplit(...args: any[]) { return record('createLeafBySplit', this, args, leaf); },
    createLeafInParent(...args: any[]) { return record('createLeafInParent', this, args, leaf); },
    splitActiveLeaf(...args: any[]) { return record('splitActiveLeaf', this, args, leaf); },
    duplicateLeaf(...args: any[]) {
      return Promise.resolve(record('duplicateLeaf', this, args, leaf));
    },
    openPopoutLeaf(...args: any[]) { return record('openPopoutLeaf', this, args, leaf); },
    openLinkText(...args: any[]) {
      return Promise.resolve(record('openLinkText', this, args, 'native-open-link'));
    },
  };
  if (!omitUnpinned) {
    workspaceMethods.getUnpinnedLeaf = function (...args: any[]) {
      return record('getUnpinnedLeaf', this, args, leaf);
    };
  }
  const rawWorkspace: any = inherited
    ? Object.assign(Object.create(workspaceMethods), { activeLeaf: leaf })
    : { activeLeaf: leaf, ...workspaceMethods };
  workspace = new Proxy(rawWorkspace, {
    set(target, property, value) {
      stats.assignments.push(String(property));
      target[property] = value;
      return true;
    },
  });
  const harness = new GuardHarness({ enableCanvasOpenGuard: enabled }, { workspace });
  return { harness, workspace, leaf, stats };
}

export function createBenchmarkEnvironment() {
  const state = { nativeCalls: 0 };
  const leaf = {};
  const workspace = {
    activeLeaf: leaf,
    getLeaf() {
      state.nativeCalls += 1;
      return leaf;
    },
  };
  const harness = new GuardHarness({ enableCanvasOpenGuard: false }, { workspace });
  return { harness, workspace, leaf, state };
}
`;

const output = ts.transpileModule(virtualSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const harnessModule = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`
);

function identities(environment) {
  return {
    workspace: Object.fromEntries(
      harnessModule.workspaceMethodNames.map((name) => [name, environment.workspace[name]]),
    ),
    leaf: Object.fromEntries(
      harnessModule.leafMethodNames.map((name) => [name, harnessModule.WorkspaceLeaf.prototype[name]]),
    ),
  };
}

function changedNames(before, after, lane) {
  return Object.keys(before[lane]).filter((name) => before[lane][name] !== after[lane][name]);
}

async function exerciseNativeRoutes(environment) {
  const file = new harnessModule.TFile('Notes/Target.md');
  const state = { type: 'markdown', state: { file: file.path } };
  const parent = {};
  const view = { getViewType: () => 'markdown' };
  const results = [
    environment.workspace.getLeaf(false),
    environment.workspace.getUnpinnedLeaf?.(),
    environment.workspace.getRightLeaf(false),
    environment.workspace.getLeftLeaf(false),
    environment.workspace.createLeafBySplit(environment.leaf, 'vertical'),
    environment.workspace.createLeafInParent(parent, 0),
    environment.workspace.splitActiveLeaf('vertical'),
    await environment.workspace.duplicateLeaf(environment.leaf, 'vertical'),
    environment.workspace.openPopoutLeaf(),
    await environment.workspace.openLinkText('Target', 'Source.md'),
    await environment.leaf.openFile(file),
    await environment.leaf.open(view),
    await environment.leaf.setViewState(state),
  ];
  assert.deepEqual(results, [
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    'native-open-link',
    'native-open-file',
    environment.leaf.view,
    state,
  ]);
  assert.ok(environment.stats.calls.every((call) => (
    call.name.startsWith('leaf.') || call.receiver === environment.workspace
  )));
  assert.deepEqual(
    environment.stats.calls.map(({ name, args }) => ({ name, args })),
    [
      { name: 'getLeaf', args: [false] },
      { name: 'getUnpinnedLeaf', args: [] },
      { name: 'getRightLeaf', args: [false] },
      { name: 'getLeftLeaf', args: [false] },
      { name: 'createLeafBySplit', args: [environment.leaf, 'vertical'] },
      { name: 'createLeafInParent', args: [parent, 0] },
      { name: 'splitActiveLeaf', args: ['vertical'] },
      { name: 'duplicateLeaf', args: [environment.leaf, 'vertical'] },
      { name: 'openPopoutLeaf', args: [] },
      { name: 'openLinkText', args: ['Target', 'Source.md'] },
      { name: 'leaf.openFile', args: [file] },
      { name: 'leaf.open', args: [view] },
      { name: 'leaf.setViewState', args: [state] },
    ],
  );
}

test('default settings avoid every Canvas-open host mutation without changing native results', async (t) => {
  assert.match(constantsSource, /enableCanvasOpenGuard:\s*false/);
  assert.ok(
    mainSource.indexOf('await this.loadSettings()')
      < mainSource.indexOf('this.restoreCanvasOpenGuard = this.shouldInstallWorkspaceOpenPatch()'),
    'settings must load before the guard-install decision',
  );

  const environment = harnessModule.createEnvironment(false);
  t.after(() => environment.harness.cleanup());
  const before = identities(environment);
  const decision = environment.harness.start();
  const after = identities(environment);
  const changedWorkspace = changedNames(before, after, 'workspace');
  const changedLeaf = changedNames(before, after, 'leaf');

  if (expectation === 'released') {
    assert.equal(decision, true);
    assert.deepEqual(changedWorkspace, harnessModule.workspaceMethodNames);
    assert.deepEqual(changedLeaf, harnessModule.leafMethodNames);
  } else {
    assert.equal(decision, false);
    assert.deepEqual(changedWorkspace, []);
    assert.deepEqual(changedLeaf, []);
    assert.deepEqual(environment.stats.assignments, []);
  }

  await exerciseNativeRoutes(environment);
  assert.equal(environment.harness.guardChecks, expectation === 'released' ? 13 : 0);
  assert.equal(environment.harness.deadBaseChecks, expectation === 'released' ? 1 : 0);
  environment.harness.cleanup();

  if (expectation === 'candidate') {
    const trackingStart = mainSource.indexOf(
      'if (this.shouldInstallWorkspaceOpenPatch()) {',
      mainSource.indexOf('// Capture right-click targets early'),
    );
    const trackingEnd = mainSource.indexOf('this.registerBasesLinkPreviewHandler()', trackingStart);
    const trackingSource = mainSource.slice(trackingStart, trackingEnd);
    assert.ok(trackingStart >= 0 && trackingEnd > trackingStart);
    assert.equal((trackingSource.match(/registerDomEvent/gu) || []).length, 9);
    assert.deepEqual(identities(environment), before);
  }
});

test('the opt-in guard retains every suppression route and restores exact host identities', async (t) => {
  const environment = harnessModule.createEnvironment(true);
  t.after(() => environment.harness.cleanup());
  const before = identities(environment);
  assert.equal(environment.harness.start(), true);
  const after = identities(environment);
  assert.deepEqual(changedNames(before, after, 'workspace'), harnessModule.workspaceMethodNames);
  assert.deepEqual(changedNames(before, after, 'leaf'), harnessModule.leafMethodNames);

  environment.harness.recentCanvasDragUntil = Number.POSITIVE_INFINITY;
  const file = new harnessModule.TFile('Notes/Suppressed.md');
  const state = { type: 'markdown', state: { file: file.path } };
  const suppressed = [
    environment.workspace.getLeaf('tab'),
    environment.workspace.getUnpinnedLeaf(),
    environment.workspace.getRightLeaf(true),
    environment.workspace.getLeftLeaf(true),
    environment.workspace.createLeafBySplit(environment.leaf, 'vertical'),
    environment.workspace.createLeafInParent({}, 0),
    environment.workspace.splitActiveLeaf('vertical'),
    await environment.workspace.duplicateLeaf(environment.leaf, 'vertical'),
    environment.workspace.openPopoutLeaf(),
    await environment.workspace.openLinkText('Suppressed', 'Source.md'),
    await environment.leaf.openFile(file),
    await environment.leaf.open({ getViewType: () => 'markdown' }),
    await environment.leaf.setViewState(state),
  ];
  assert.deepEqual(suppressed, [
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    environment.leaf,
    undefined,
    undefined,
    environment.leaf.view,
    undefined,
  ]);
  const targetedOriginals = new Set(environment.stats.calls.map((call) => call.name));
  for (const name of [
    'getLeaf',
    'getRightLeaf',
    'getLeftLeaf',
    'createLeafBySplit',
    'createLeafInParent',
    'splitActiveLeaf',
    'duplicateLeaf',
    'openPopoutLeaf',
    'openLinkText',
    'leaf.openFile',
    'leaf.open',
    'leaf.setViewState',
  ]) {
    assert.equal(targetedOriginals.has(name), false, `${name} must remain suppressed`);
  }

  environment.harness.recentCanvasDragUntil = 0;
  environment.stats.calls.length = 0;
  environment.harness.guardChecks = 0;
  await exerciseNativeRoutes(environment);
  assert.equal(environment.harness.guardChecks, 13);

  environment.harness.cleanup();
  assert.deepEqual(identities(environment).leaf, before.leaf);
  if (expectation === 'candidate') {
    assert.deepEqual(identities(environment).workspace, before.workspace);

    const inherited = harnessModule.createEnvironment(true, false, true);
    t.after(() => inherited.harness.cleanup());
    const inheritedBefore = identities(inherited);
    assert.ok(harnessModule.workspaceMethodNames.every((name) => (
      !Object.prototype.hasOwnProperty.call(inherited.workspace, name)
    )));
    inherited.harness.start();
    assert.ok(harnessModule.workspaceMethodNames.every((name) => (
      Object.prototype.hasOwnProperty.call(inherited.workspace, name)
    )));
    inherited.harness.cleanup();
    assert.deepEqual(identities(inherited).workspace, inheritedBefore.workspace);
    assert.ok(harnessModule.workspaceMethodNames.every((name) => (
      !Object.prototype.hasOwnProperty.call(inherited.workspace, name)
    )));
  }
});

test('the candidate removes the dead Base-open branch and handles a missing fallback API', (t) => {
  if (expectation === 'released') {
    assert.match(mainSource, /private shouldAllowNativeBaseLinkOpen/);
    assert.match(mainSource, /private interceptNativeBaseLinkOpen/);
    return;
  }

  assert.doesNotMatch(mainSource, /shouldAllowNativeBaseLinkOpen/);
  assert.doesNotMatch(mainSource, /interceptNativeBaseLinkOpen/);
  assert.doesNotMatch(mainSource, /basesLinkPreviewNativeOpenPath/);
  assert.doesNotMatch(mainSource, /basesLinkPreviewNativeOpenUntil/);
  assert.doesNotMatch(mainSource, /suppressCanvasActivationEvent/);

  const environment = harnessModule.createEnvironment(true, true);
  t.after(() => environment.harness.cleanup());
  assert.equal(environment.harness.start(), true);
  environment.harness.recentCanvasDragUntil = Number.POSITIVE_INFINITY;
  assert.equal(environment.workspace.getLeaf('tab'), environment.leaf);
  environment.harness.cleanup();
});

test('disabled dispatch removes deterministic guard work and reports comparative timing', (t) => {
  const environment = harnessModule.createBenchmarkEnvironment();
  t.after(() => environment.harness.cleanup());
  environment.harness.start();
  const iterations = 2_000_000;
  const roundTimes = [];
  let checksum = 0;
  for (let round = 0; round < 7; round += 1) {
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      if (environment.workspace.getLeaf(false) === environment.leaf) checksum += 1;
    }
    roundTimes.push(performance.now() - startedAt);
  }
  const totalCalls = iterations * roundTimes.length;
  const medianMs = [...roundTimes].sort((a, b) => a - b)[Math.floor(roundTimes.length / 2)];
  assert.equal(checksum, totalCalls);
  assert.equal(environment.state.nativeCalls, totalCalls);
  assert.equal(
    environment.harness.guardChecks,
    expectation === 'released' ? totalCalls : 0,
  );
  console.log(JSON.stringify({
    sourceRoot,
    expectation,
    calls: totalCalls,
    guardChecks: environment.harness.guardChecks,
    medianMs: Number(medianMs.toFixed(3)),
    medianNsPerCall: Number(((medianMs * 1_000_000) / iterations).toFixed(3)),
  }));
  environment.harness.cleanup();
});
