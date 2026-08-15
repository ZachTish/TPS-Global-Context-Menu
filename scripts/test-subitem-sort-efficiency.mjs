import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = process.env.TPS_GCM_SUBITEM_SORT_SOURCE_ROOT
  ? resolve(process.env.TPS_GCM_SUBITEM_SORT_SOURCE_ROOT)
  : repositoryRoot;
const releasedRoot = process.env.TPS_GCM_SUBITEM_SORT_RELEASED_ROOT
  ? resolve(process.env.TPS_GCM_SUBITEM_SORT_RELEASED_ROOT)
  : null;
const expectation = process.env.TPS_GCM_SUBITEM_SORT_EXPECTATION || 'candidate';
const releasedPanelBuilderHash = 'd24ea30eb0ff85702d6f732fc63fadc73f3f84233c1c8587393e3f604877ef6e';

assert.ok(
  expectation === 'released' || expectation === 'candidate',
  `Unknown TPS_GCM_SUBITEM_SORT_EXPECTATION: ${expectation}`,
);

function extractMethod(source, methodName, sourcePath) {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let method = null;
  const visit = (node) => {
    if (ts.isMethodDeclaration(node) && node.name?.getText(sourceFile) === methodName) {
      method = node.getText(sourceFile);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(method, `Missing ${methodName} in ${sourcePath}`);
  return method;
}

async function loadSortHarness(root, expectedHash = null) {
  const sourcePath = resolve(root, 'src/menu/panel-builder.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const sourceHash = createHash('sha256').update(source).digest('hex');
  if (expectedHash) {
    assert.equal(sourceHash, expectedHash, 'released comparison must use exact 1.11.11 panel-builder source');
  }
  const method = extractMethod(source, 'buildSubitemTreeRecursive', sourcePath);
  const virtualSource = `
    type SubitemRelationKind = 'child' | 'attachment';
    interface SubitemRelationEntry {
      file: TFile;
      relations: Set<SubitemRelationKind>;
    }
    interface SubitemNode {
      file: TFile;
      relations: SubitemRelationKind[];
      children: SubitemNode[];
      hidden?: boolean;
    }
    class SubitemMetadataService {
      getTaskIdentityForFile(_file: TFile) {
        return {
          isComplete: false,
          isWontDo: false,
          isPending: false,
          allStatuses: [] as string[],
        };
      }
    }
    const MAX_SUBITEM_DEPTH = 12;
    const normalizePath = (value: string) =>
      String(value || '').replace(/\\\\/gu, '/').replace(/\\/+/gu, '/');

    export class TFile {
      path: string;
      name: string;
      basename: string;
      extension: string;
      stat = { ctime: 1, mtime: 1 };

      constructor(path: string) {
        this.path = path;
        this.name = path.split('/').pop() || '';
        const extensionIndex = this.name.lastIndexOf('.');
        this.extension = extensionIndex >= 0 ? this.name.slice(extensionIndex + 1) : '';
        this.basename = extensionIndex >= 0 ? this.name.slice(0, extensionIndex) : this.name;
      }
    }

    export class SortHarness {
      private readonly rootPath = '__subitem_sort_root__.canvas';
      private readonly app: any;
      private readonly plugin: any;
      private readonly subitemMetadataService: SubitemMetadataService;

      constructor(
        private readonly entries: SubitemRelationEntry[],
        readCache: (file: TFile) => unknown,
        private readonly readSortField: () => string,
        private readonly identities: Map<string, ReturnType<SubitemMetadataService['getTaskIdentityForFile']>>,
        private readonly titles: Map<string, string>,
        private readonly hiddenPaths: Set<string>,
        private readonly ignoredPaths: Set<string>,
      ) {
        this.app = {
          metadataCache: {
            getFileCache: readCache,
          },
        };
        this.plugin = {
          parentLinkResolutionService: {
            getLogicalFrontmatter: (file: TFile) =>
              (readCache(file) as { frontmatter?: Record<string, unknown> } | null)?.frontmatter ?? {},
            isRelationshipTarget: (file: unknown): file is TFile => file instanceof TFile,
            isIgnoredFile: (file: TFile) => this.ignoredPaths.has(file.path),
          },
        };
        this.subitemMetadataService = {
          getTaskIdentityForFile: (file: TFile) => this.identities.get(file.path) ?? {
            isComplete: false,
            isWontDo: false,
            isPending: false,
            allStatuses: [],
          },
        } as SubitemMetadataService;
      }

      private async collectDirectSubitemRelations(
        file: TFile,
        _parentIndex: Map<string, TFile[]>,
      ): Promise<Map<string, SubitemRelationEntry>> {
        if (file.path !== this.rootPath) return new Map();
        return new Map(this.entries.map((entry) => [entry.file.path, entry]));
      }

      private shouldIgnoreSubitemFile(file: TFile): boolean {
        return this.ignoredPaths.has(file.path);
      }

      private isArchived(file: TFile): boolean {
        return this.hiddenPaths.has(file.path);
      }

      private getSortField(): string {
        return this.readSortField();
      }

      private getFileDisplayTitle(file: TFile): string {
        return this.titles.get(file.path) ?? file.basename;
      }

      ${method}

      run(): Promise<SubitemNode[]> {
        const root = new TFile(this.rootPath);
        return this.buildSubitemTreeRecursive(
          root,
          new Map(),
          new Set([normalizePath(root.path)]),
          0,
        );
      }
    }
  `;
  const output = ts.transpileModule(virtualSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(output).toString('base64')}#${sourceHash}`
  );
  return { ...module, method, sourceHash };
}

const underTest = await loadSortHarness(
  sourceRoot,
  expectation === 'released' ? releasedPanelBuilderHash : null,
);
const releasedComparison = releasedRoot
  ? await loadSortHarness(releasedRoot, releasedPanelBuilderHash)
  : null;

function identity(overrides = {}) {
  return {
    isComplete: false,
    isWontDo: false,
    isPending: false,
    allStatuses: ['todo'],
    ...overrides,
  };
}

function entrySpec(index, overrides = {}) {
  const path = overrides.path ?? `Items/Item ${String(index).padStart(5, '0')}.canvas`;
  return {
    path,
    relations: overrides.relations ?? ['child'],
    frontmatter: overrides.frontmatter ?? { sort: index },
    identity: overrides.identity ?? identity(),
    title: overrides.title ?? `Item ${String(index).padStart(5, '0')}`,
    hidden: overrides.hidden ?? false,
    ignored: overrides.ignored ?? false,
  };
}

function materializeScenario(module, specs, options = {}) {
  const files = new Map();
  const identities = new Map();
  const titles = new Map();
  const hiddenPaths = new Set();
  const ignoredPaths = new Set();
  const caches = new Map();
  const stats = {
    metadataReads: 0,
    sortFieldReads: 0,
    readsByPath: new Map(),
  };

  const entries = specs.map((spec) => {
    const file = new module.TFile(spec.path);
    files.set(spec.path, file);
    identities.set(spec.path, spec.identity);
    titles.set(spec.path, spec.title);
    caches.set(spec.path, { frontmatter: spec.frontmatter });
    if (spec.hidden) hiddenPaths.add(spec.path);
    if (spec.ignored) ignoredPaths.add(spec.path);
    return {
      file,
      relations: new Set(spec.relations),
    };
  });

  const readCache = (file) => {
    stats.metadataReads += 1;
    const count = (stats.readsByPath.get(file.path) ?? 0) + 1;
    stats.readsByPath.set(file.path, count);
    if (options.readCache) {
      return options.readCache(file, count, caches.get(file.path));
    }
    return caches.get(file.path) ?? null;
  };
  const readSortField = () => {
    stats.sortFieldReads += 1;
    if (options.readSortField) return options.readSortField(stats.sortFieldReads);
    return options.sortField ?? 'sort';
  };
  const harness = new module.SortHarness(
    entries,
    readCache,
    readSortField,
    identities,
    titles,
    hiddenPaths,
    ignoredPaths,
  );
  return { harness, files, stats };
}

function nodeSignature(nodes) {
  return nodes.map((node) => ({
    path: node.file.path,
    relations: [...node.relations],
    hidden: node.hidden === true,
    children: nodeSignature(node.children),
  }));
}

function getSortValue(frontmatter, sortField) {
  if (!frontmatter) return undefined;
  if (sortField in frontmatter) return frontmatter[sortField];
  const lowerKey = sortField.toLowerCase();
  for (const key of Object.keys(frontmatter)) {
    if (key.toLowerCase() === lowerKey) return frontmatter[key];
  }
  return undefined;
}

function statusWeight(spec) {
  const value = spec.identity;
  if (value.isComplete || value.isWontDo) return 4;
  if (value.allStatuses.some((status) => status === 'working' || status === 'in-progress')) return 1;
  if (value.allStatuses.includes('blocked')) return 2;
  if (value.isPending || value.allStatuses.length === 0) return 3;
  return 5;
}

function referenceOrder(specs, sortField = 'sort') {
  return specs
    .filter((spec) => !spec.ignored)
    .map((spec, index) => ({ spec, index }))
    .sort((left, right) => {
      const a = left.spec;
      const b = right.spec;
      if (sortField) {
        const aValue = getSortValue(a.frontmatter, sortField);
        const bValue = getSortValue(b.frontmatter, sortField);
        const hasA = aValue !== undefined && aValue !== null && aValue !== '';
        const hasB = bValue !== undefined && bValue !== null && bValue !== '';
        if (hasA && hasB) {
          const aNumber = Number(aValue);
          const bNumber = Number(bValue);
          if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber)) {
            return aNumber - bNumber;
          }
          return String(aValue).localeCompare(String(bValue));
        }
        if (hasA && !hasB) return -1;
        if (!hasA && hasB) return 1;
      }

      const aChild = a.relations.includes('child') ? 0 : 1;
      const bChild = b.relations.includes('child') ? 0 : 1;
      if (aChild !== bChild) return aChild - bChild;
      const aStatus = statusWeight(a);
      const bStatus = statusWeight(b);
      if (aStatus !== bStatus) return aStatus - bStatus;
      return a.title.localeCompare(b.title);
    })
    .map(({ spec }) => spec.path);
}

function assertOriginalFileIdentities(nodes, files) {
  const visit = (items) => {
    for (const node of items) {
      assert.equal(node.file, files.get(node.file.path), `file identity changed for ${node.file.path}`);
      visit(node.children);
    }
  };
  visit(nodes);
}

function createRandom(seedValue) {
  let state = seedValue >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomSpecs(random, scenarioIndex) {
  const values = [
    undefined,
    null,
    '',
    ' ',
    false,
    true,
    -5,
    0,
    3.5,
    '002',
    '10',
    'Alpha',
    'beta',
    ['two', 'values'],
    { order: 3 },
  ];
  const statuses = [
    identity(),
    identity({ allStatuses: ['working'] }),
    identity({ allStatuses: ['in-progress'] }),
    identity({ allStatuses: ['blocked'] }),
    identity({ allStatuses: [] }),
    identity({ isPending: true, allStatuses: ['todo'] }),
    identity({ isComplete: true, allStatuses: ['complete'] }),
    identity({ isWontDo: true, allStatuses: ['wont-do'] }),
    identity({ allStatuses: ['other'] }),
  ];
  const count = Math.floor(random() * 48);
  const specs = [];
  for (let index = 0; index < count; index += 1) {
    const value = values[Math.floor(random() * values.length)];
    const key = ['sort', 'Sort', 'SORT'][Math.floor(random() * 3)];
    const frontmatter = {};
    if (random() > 0.14) frontmatter[key] = value;
    if (random() < 0.08) {
      frontmatter.Sort = 'case-insensitive-alternative';
      frontmatter.sort = value;
    }
    specs.push(entrySpec(index, {
      path: `Random/${scenarioIndex}/${index}.${random() < 0.75 ? 'md' : 'canvas'}`,
      relations: random() < 0.68 ? ['child'] : ['attachment'],
      frontmatter,
      identity: statuses[Math.floor(random() * statuses.length)],
      title: ['Alpha', 'beta', 'Gamma', 'same'][Math.floor(random() * 4)] + ` ${index % 9}`,
      hidden: random() < 0.12,
      ignored: random() < 0.08,
    }));
  }
  return specs;
}

test('the compiled subitem sort preserves every released value and secondary-ordering branch', async () => {
  const edgeSpecs = [
    entrySpec(0, { frontmatter: { sort: -4 }, relations: ['attachment'], hidden: true }),
    entrySpec(1, { frontmatter: { Sort: '002' }, relations: ['child'] }),
    entrySpec(2, { frontmatter: { sort: 10 }, relations: ['child'] }),
    entrySpec(3, { frontmatter: { sort: 'Alpha' }, relations: ['child'] }),
    entrySpec(4, { frontmatter: { sort: 'beta' }, relations: ['child'] }),
    entrySpec(5, { frontmatter: { Sort: 'alternative', sort: 'exact' }, relations: ['child'] }),
    entrySpec(6, { frontmatter: {}, relations: ['child'], identity: identity({ allStatuses: ['working'] }) }),
    entrySpec(7, { frontmatter: { sort: null }, relations: ['child'], identity: identity({ allStatuses: ['blocked'] }) }),
    entrySpec(8, { frontmatter: { sort: '' }, relations: ['child'], identity: identity({ isPending: true, allStatuses: [] }) }),
    entrySpec(9, { frontmatter: {}, relations: ['child'], identity: identity({ isComplete: true, allStatuses: ['complete'] }) }),
    entrySpec(10, { frontmatter: {}, relations: ['child'], identity: identity({ allStatuses: ['other'] }) }),
    entrySpec(11, { frontmatter: {}, relations: ['attachment'], title: 'Zulu' }),
    entrySpec(12, { frontmatter: {}, relations: ['attachment'], title: 'Alpha' }),
    entrySpec(13, { frontmatter: { sort: false }, relations: ['attachment'] }),
    entrySpec(14, { frontmatter: { sort: ['two', 'values'] }, relations: ['attachment'] }),
    entrySpec(15, { frontmatter: { sort: { order: 3 } }, relations: ['attachment'] }),
    entrySpec(16, { frontmatter: { sort: 3 }, ignored: true }),
  ];
  const scenario = materializeScenario(underTest, edgeSpecs);
  const nodes = await scenario.harness.run();
  assert.deepEqual(nodes.map((node) => node.file.path), referenceOrder(edgeSpecs));
  assert.deepEqual(
    nodeSignature(nodes),
    referenceOrder(edgeSpecs).map((path) => {
      const spec = edgeSpecs.find((entry) => entry.path === path);
      return {
        path,
        relations: spec.relations,
        hidden: spec.hidden || spec.identity.isComplete || spec.identity.isWontDo,
        children: [],
      };
    }),
  );
  assertOriginalFileIdentities(nodes, scenario.files);

  const eligibleCount = edgeSpecs.filter((spec) => !spec.ignored).length;
  if (expectation === 'candidate') {
    assert.equal(scenario.stats.metadataReads, eligibleCount);
    assert.equal(scenario.stats.sortFieldReads, 1);
    assert.ok([...scenario.stats.readsByPath.values()].every((count) => count === 1));
  } else {
    assert.ok(scenario.stats.metadataReads > eligibleCount);
    assert.equal(scenario.stats.sortFieldReads, scenario.stats.metadataReads / 2);
  }
});

test('empty and singleton trees avoid sort setup while failures still propagate for real sorts', async () => {
  for (const specs of [[], [entrySpec(0)]]) {
    const scenario = materializeScenario(underTest, specs, {
      readSortField: () => {
        throw new Error('sort field must not be read');
      },
      readCache: () => {
        throw new Error('metadata must not be read');
      },
    });
    const nodes = await scenario.harness.run();
    assert.equal(nodes.length, specs.length);
    assert.equal(scenario.stats.sortFieldReads, 0);
    assert.equal(scenario.stats.metadataReads, 0);
  }

  const noFieldSpecs = [
    entrySpec(0, { relations: ['attachment'], title: 'Zulu' }),
    entrySpec(1, { relations: ['child'], title: 'Beta' }),
    entrySpec(2, { relations: ['child'], title: 'Alpha' }),
  ];
  const noFieldScenario = materializeScenario(underTest, noFieldSpecs, {
    sortField: '',
    readCache: () => {
      throw new Error('metadata must not be read without a custom sort field');
    },
  });
  const noFieldNodes = await noFieldScenario.harness.run();
  assert.deepEqual(
    noFieldNodes.map((node) => node.file.path),
    referenceOrder(noFieldSpecs, ''),
  );
  if (expectation === 'candidate') {
    assert.equal(noFieldScenario.stats.sortFieldReads, 1);
  } else {
    assert.ok(noFieldScenario.stats.sortFieldReads > 1);
  }
  assert.equal(noFieldScenario.stats.metadataReads, 0);

  const twoSpecs = [entrySpec(0), entrySpec(1)];
  const fieldFailure = materializeScenario(underTest, twoSpecs, {
    readSortField: () => {
      throw new Error('synthetic sort-field failure');
    },
  });
  await assert.rejects(fieldFailure.harness.run(), /synthetic sort-field failure/u);

  const cacheFailure = materializeScenario(underTest, twoSpecs, {
    readCache: (file, _count, cache) => {
      if (file.path === twoSpecs[1].path) throw new Error('synthetic cache failure');
      return cache;
    },
  });
  await assert.rejects(cacheFailure.harness.run(), /synthetic cache failure/u);

  const getterFrontmatter = {};
  Object.defineProperty(getterFrontmatter, 'sort', {
    enumerable: true,
    get() {
      throw new Error('synthetic value failure');
    },
  });
  const getterFailure = materializeScenario(underTest, [
    entrySpec(0, { frontmatter: getterFrontmatter }),
    entrySpec(1),
  ]);
  await assert.rejects(getterFailure.harness.run(), /synthetic value failure/u);
});

test('one metadata snapshot per sibling prevents repeated and incoherent comparator reads', async () => {
  const specs = Array.from({ length: 256 }, (_, index) => entrySpec(index, {
    frontmatter: { Sort: (index * 2654435761) >>> 0 },
  }));
  const scenario = materializeScenario(underTest, specs, {
    readCache: (file, count, cache) => {
      if (count > 1) throw new Error(`repeated metadata read: ${file.path}`);
      return cache;
    },
  });

  if (expectation === 'candidate') {
    const nodes = await scenario.harness.run();
    assert.deepEqual(nodes.map((node) => node.file.path), referenceOrder(specs));
    assert.equal(scenario.stats.metadataReads, specs.length);
    assert.equal(scenario.stats.sortFieldReads, 1);
  } else {
    await assert.rejects(scenario.harness.run(), /repeated metadata read/u);
    assert.ok(scenario.stats.metadataReads > 1);
  }

  const methodSortStart = underTest.method.indexOf('.sort((a, b) =>');
  assert.ok(methodSortStart >= 0);
  const comparatorSource = underTest.method.slice(methodSortStart);
  if (expectation === 'candidate') {
    assert.equal((underTest.method.match(/getLogicalFrontmatter\(/gu) || []).length, 1);
    assert.doesNotMatch(comparatorSource, /getLogicalFrontmatter\(/u);
  } else {
    assert.equal((underTest.method.match(/metadataCache\.getFileCache\(/gu) || []).length, 2);
    assert.match(comparatorSource, /metadataCache\.getFileCache\(/u);
  }
});

test('5,000 randomized actual-method scenarios preserve order, identity, and relations', async () => {
  const random = createRandom(0x5a17c0de);
  const metrics = {
    scenarios: 5000,
    eligibleEntries: 0,
    candidateMetadataReads: 0,
    candidateSortFieldReads: 0,
    releasedMetadataReads: 0,
    releasedSortFieldReads: 0,
  };

  for (let scenarioIndex = 0; scenarioIndex < metrics.scenarios; scenarioIndex += 1) {
    const specs = randomSpecs(random, scenarioIndex);
    const expectedPaths = referenceOrder(specs);
    metrics.eligibleEntries += specs.filter((spec) => !spec.ignored).length;

    const candidateScenario = materializeScenario(underTest, specs);
    const candidateNodes = await candidateScenario.harness.run();
    assert.deepEqual(candidateNodes.map((node) => node.file.path), expectedPaths);
    assertOriginalFileIdentities(candidateNodes, candidateScenario.files);
    metrics.candidateMetadataReads += candidateScenario.stats.metadataReads;
    metrics.candidateSortFieldReads += candidateScenario.stats.sortFieldReads;

    if (expectation === 'candidate') {
      const eligible = specs.filter((spec) => !spec.ignored).length;
      assert.equal(candidateScenario.stats.metadataReads, eligible > 1 ? eligible : 0);
      assert.equal(candidateScenario.stats.sortFieldReads, eligible > 1 ? 1 : 0);
      assert.ok([...candidateScenario.stats.readsByPath.values()].every((count) => count === 1));
    }

    if (releasedComparison) {
      const releasedScenario = materializeScenario(releasedComparison, specs);
      const releasedNodes = await releasedScenario.harness.run();
      assert.deepEqual(nodeSignature(candidateNodes), nodeSignature(releasedNodes));
      assertOriginalFileIdentities(releasedNodes, releasedScenario.files);
      metrics.releasedMetadataReads += releasedScenario.stats.metadataReads;
      metrics.releasedSortFieldReads += releasedScenario.stats.sortFieldReads;
    }
  }

  if (expectation === 'candidate') {
    assert.ok(metrics.candidateMetadataReads <= metrics.eligibleEntries);
  }
  if (releasedComparison) {
    assert.ok(metrics.releasedMetadataReads > metrics.candidateMetadataReads);
    assert.ok(metrics.releasedSortFieldReads > metrics.candidateSortFieldReads);
    metrics.metadataReadReductionPercent = Number(
      ((1 - metrics.candidateMetadataReads / metrics.releasedMetadataReads) * 100).toFixed(3),
    );
    metrics.sortFieldReadReductionPercent = Number(
      ((1 - metrics.candidateSortFieldReads / metrics.releasedSortFieldReads) * 100).toFixed(3),
    );
  }
  console.log(JSON.stringify({
    test: 'subitem-sort-randomized',
    sourceRoot,
    releasedRoot,
    expectation,
    ...metrics,
  }));
});

if (releasedComparison && expectation === 'candidate') {
  test('alternating 20,000-sibling actual-method benchmark reduces deterministic work and median time', async () => {
    const random = createRandom(0x20_000);
    const specs = Array.from({ length: 20_000 }, (_, index) => entrySpec(index, {
      frontmatter: {
        [index % 2 === 0 ? 'sort' : 'Sort']: Math.floor(random() * 1_000_000_000),
      },
    }));

    const runTimed = async (module) => {
      const scenario = materializeScenario(module, specs);
      const startedAt = performance.now();
      const nodes = await scenario.harness.run();
      const durationMs = performance.now() - startedAt;
      return {
        durationMs,
        metadataReads: scenario.stats.metadataReads,
        sortFieldReads: scenario.stats.sortFieldReads,
        signature: `${nodes.length}:${nodes[0]?.file.path}:${nodes.at(-1)?.file.path}`,
      };
    };

    await runTimed(releasedComparison);
    await runTimed(underTest);

    const releasedTimes = [];
    const candidateTimes = [];
    let releasedSample = null;
    let candidateSample = null;
    for (let round = 0; round < 13; round += 1) {
      if (round % 2 === 0) {
        releasedSample = await runTimed(releasedComparison);
        candidateSample = await runTimed(underTest);
      } else {
        candidateSample = await runTimed(underTest);
        releasedSample = await runTimed(releasedComparison);
      }
      releasedTimes.push(releasedSample.durationMs);
      candidateTimes.push(candidateSample.durationMs);
      assert.equal(candidateSample.signature, releasedSample.signature);
    }

    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const releasedMedianMs = median(releasedTimes);
    const candidateMedianMs = median(candidateTimes);
    assert.equal(candidateSample.metadataReads, specs.length);
    assert.equal(candidateSample.sortFieldReads, 1);
    assert.ok(releasedSample.metadataReads > candidateSample.metadataReads);
    assert.ok(releasedSample.sortFieldReads > candidateSample.sortFieldReads);
    assert.ok(
      candidateMedianMs < releasedMedianMs,
      `candidate median ${candidateMedianMs.toFixed(3)} ms must improve released ${releasedMedianMs.toFixed(3)} ms`,
    );

    console.log(JSON.stringify({
      test: 'subitem-sort-benchmark',
      siblings: specs.length,
      rounds: releasedTimes.length,
      releasedMetadataReads: releasedSample.metadataReads,
      candidateMetadataReads: candidateSample.metadataReads,
      metadataReadReductionPercent: Number(
        ((1 - candidateSample.metadataReads / releasedSample.metadataReads) * 100).toFixed(3),
      ),
      releasedSortFieldReads: releasedSample.sortFieldReads,
      candidateSortFieldReads: candidateSample.sortFieldReads,
      releasedMedianMs: Number(releasedMedianMs.toFixed(3)),
      candidateMedianMs: Number(candidateMedianMs.toFixed(3)),
      medianReductionPercent: Number(
        ((1 - candidateMedianMs / releasedMedianMs) * 100).toFixed(3),
      ),
    }));
  });
}
