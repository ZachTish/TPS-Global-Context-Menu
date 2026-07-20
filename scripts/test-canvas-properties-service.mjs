import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadCanvasPropertiesServiceModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/canvas-properties-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-canvas-test-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian-stub', namespace: 'obsidian-stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'obsidian-stub' }, () => ({
          contents: `
            export class TFile {
              constructor(path) {
                this.path = path;
                this.extension = path.includes('.') ? path.split('.').pop() : '';
                this.basename = path.split('/').pop().replace(/\\.[^.]+$/, '');
              }
              static [Symbol.hasInstance](value) {
                return Boolean(value && typeof value.path === 'string' && typeof value.extension === 'string');
              }
            }
            export class Notice {}
          `,
          loader: 'js',
        }));
      },
    }],
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

function createCanvasHarness(initialDocument, options = {}) {
  const {
    cacheAvailable = true,
    cacheSignatureValid = true,
    cachedFrontmatter,
    explicitEventError = null,
    processError = null,
  } = options;
  const file = {
    path: 'Boards/Atomic.canvas',
    extension: 'canvas',
    basename: 'Atomic',
    stat: { mtime: 1 },
  };
  let content = typeof initialDocument === 'string'
    ? initialDocument
    : `${JSON.stringify(initialDocument, null, 2)}\n`;
  let currentCacheAvailable = cacheAvailable;
  let currentCacheSignatureValid = cacheSignatureValid;
  let deriveCacheFromContent = !Object.prototype.hasOwnProperty.call(options, 'cachedFrontmatter');
  let currentCachedFrontmatter = cachedFrontmatter;
  let processQueue = Promise.resolve();
  const metadataChangedListeners = new Set();
  const vaultDeleteListeners = new Set();
  const registeredEvents = [];
  const calls = {
    modify: 0,
    process: 0,
    read: 0,
    writes: 0,
  };
  const events = {
    explicit: [],
    filesUpdated: [],
    workspace: [],
  };
  const readDynamicFrontmatter = () => {
    try {
      return JSON.parse(content)?.metadata?.frontmatter;
    } catch {
      return undefined;
    }
  };
  const createMetadataCache = (frontmatter) => {
    if (!currentCacheSignatureValid) return { frontmatter };
    return {
      v: 1,
      frontmatterPosition: {
        start: { line: 0, col: 0, offset: 0 },
        end: { line: 0, col: 0, offset: 0 },
      },
      frontmatter,
      frontmatterLinks: [],
      nodes: {},
      links: [],
      embeds: [],
    };
  };
  const getCurrentCache = () => {
    if (!currentCacheAvailable) return null;
    return createMetadataCache(deriveCacheFromContent ? readDynamicFrontmatter() : currentCachedFrontmatter);
  };
  const plugin = {
    registerEvent(eventRef) {
      registeredEvents.push(eventRef);
      return eventRef;
    },
    manifest: { id: 'tps-global-context-menu' },
    settings: {
      properties: [
        { key: 'status' },
        { key: 'priority' },
        { key: 'tags' },
      ],
    },
    eventService: {
      emitExplicitAction(paths, options) {
        events.explicit.push({ paths, options });
        if (explicitEventError) throw explicitEventError;
      },
      emitFilesUpdated(paths, options) {
        events.filesUpdated.push({ paths, options });
      },
    },
    app: {
      metadataCache: {
        getFileCache() {
          return getCurrentCache();
        },
        on(name, callback) {
          assert.equal(name, 'changed');
          metadataChangedListeners.add(callback);
          return { off: () => metadataChangedListeners.delete(callback) };
        },
      },
      vault: {
        on(name, callback) {
          assert.equal(name, 'delete');
          vaultDeleteListeners.add(callback);
          return { off: () => vaultDeleteListeners.delete(callback) };
        },
        async read() {
          calls.read += 1;
          return content;
        },
        async modify(_file, next) {
          calls.modify += 1;
          content = next;
        },
        process(targetFile, mutator) {
          calls.process += 1;
          const operation = processQueue.then(() => {
            if (processError) throw processError;
            const current = content;
            const next = mutator(current);
            if (typeof next !== 'string') {
              throw new TypeError('Vault.process mutators must return a string synchronously.');
            }
            if (next !== current) {
              calls.writes += 1;
              content = next;
              targetFile.stat.mtime += 1;
            }
            return content;
          });
          processQueue = operation.catch(() => undefined);
          return operation;
        },
      },
      workspace: {
        trigger(name, ...args) {
          events.workspace.push({ name, args });
        },
      },
    },
  };
  return {
    calls,
    events,
    file,
    getContent: () => content,
    registeredEvents,
    emitDelete(targetFile = file) {
      for (const listener of vaultDeleteListeners) listener(targetFile);
    },
    emitMetadataChanged(frontmatter, targetFile = file) {
      deriveCacheFromContent = false;
      currentCachedFrontmatter = frontmatter;
      const cache = getCurrentCache();
      for (const listener of metadataChangedListeners) listener(targetFile, content, cache);
    },
    setCacheAvailable(value) {
      currentCacheAvailable = value;
    },
    setCacheSignatureValid(value) {
      currentCacheSignatureValid = value;
    },
    setCachedFrontmatter(frontmatter) {
      deriveCacheFromContent = false;
      currentCachedFrontmatter = frontmatter;
    },
    plugin,
  };
}

const { CanvasPropertiesService } = await loadCanvasPropertiesServiceModule();

test('canvas properties use one atomic Vault.process writer without GCM host interception', () => {
  const service = read('src/services/canvas-properties-service.ts');
  assert.match(service, /this\.plugin\.app\.vault\.process\(file, \(data\) =>/);
  assert.match(service, /SUPPORTED_CANVAS_METADATA_VERSION = '1\.0-1\.0'/);
  assert.match(service, /assertSynchronousMutatorResult/);
  assert.match(service, /assertCanvasPostcondition/);
  assert.match(service, /removeEmptyValuesChangedByMutation/);
  assert.match(service, /Object\.defineProperty\(target, key/);
  assert.match(service, /getCanvasMetadataCacheSnapshot/);
  assert.match(service, /value\.v !== 1/);
  assert.match(service, /isZeroCanvasPositionRange\(value\.frontmatterPosition\)/);
  assert.match(service, /Array\.isArray\(value\.frontmatterLinks\)/);
  assert.match(service, /Advanced Canvas metadata/);
  assert.match(service, /pendingCommittedFrontmatter/);
  assert.match(service, /new WeakMap<TFile, PendingCanvasFrontmatter>/);
  assert.doesNotMatch(service, /processFrontmatterWithNativeDelegate/);
  assert.doesNotMatch(service, /resolveFrontmatterWriter/);
  assert.doesNotMatch(service, /__tpsGcmFrontmatterPatch/);
  assert.doesNotMatch(service, /fileManager/);
  assert.doesNotMatch(service, /waitForCanvasMetadata/);
  assert.doesNotMatch(service, /writeCanvasMetadataCompatibilityFallback/);
  assert.doesNotMatch(service, /vault\.read\(/);
  assert.doesNotMatch(service, /vault\.modify\(/);
  assert.doesNotMatch(service, /applyToFiles\(files, async/);
  assert.match(service, /tps:gcm-canvas-properties-updated/);
  const api = read('src/plugin-api.ts');
  assert.match(api, /canvasPropertiesApi = \{[\s\S]*mutator: \(frontmatter: Record<string, unknown>\) => void,/);
  assert.doesNotMatch(api, /canvasPropertiesApi = \{[\s\S]*mutator: \(frontmatter: Record<string, unknown>\) => void \| Promise<void>/);
});

test('atomic canvas mutation preserves nodes, edges, document fields, metadata siblings, and known version in one durable write', async () => {
  const original = {
    nodes: [
      { id: 'n1', type: 'text', text: 'Keep me', x: 1, y: 2, width: 300, height: 200 },
      { id: 'n2', type: 'file', file: 'Inbox/Source.md', x: 400, y: 2, width: 300, height: 200 },
    ],
    edges: [{ id: 'e1', fromNode: 'n1', toNode: 'n2', fromSide: 'right', toSide: 'left' }],
    color: '#123456',
    metadata: {
      version: '1.0-1.0',
      frontmatter: {
        status: 'open',
        nested: { retain: true },
        nullableSibling: null,
        emptyListSibling: [],
      },
      viewport: { x: 42, y: 9, zoom: 1.25 },
      customSibling: ['preserve', 2],
    },
  };
  const harness = createCanvasHarness(original);
  const service = new CanvasPropertiesService(harness.plugin);

  const changed = await service.process(harness.file, (frontmatter) => {
    frontmatter.status = 'done';
    frontmatter.tags = ['#Alpha', 'alpha', 'Beta'];
  });

  assert.equal(changed, true);
  assert.deepEqual(harness.calls, { modify: 0, process: 1, read: 0, writes: 1 });
  const persisted = JSON.parse(harness.getContent());
  assert.deepEqual(persisted.nodes, original.nodes);
  assert.deepEqual(persisted.edges, original.edges);
  assert.equal(persisted.color, original.color);
  assert.equal(persisted.metadata.version, '1.0-1.0');
  assert.deepEqual(persisted.metadata.viewport, original.metadata.viewport);
  assert.deepEqual(persisted.metadata.customSibling, original.metadata.customSibling);
  assert.deepEqual(persisted.metadata.frontmatter, {
    status: 'done',
    tags: ['alpha', 'beta'],
    nested: { retain: true },
    nullableSibling: null,
    emptyListSibling: [],
  });
  assert.deepEqual(harness.events.explicit, [{
    paths: [harness.file.path],
    options: { source: 'advanced-canvas-properties' },
  }]);
  assert.deepEqual(harness.events.filesUpdated, [{
    paths: [harness.file.path],
    options: { sourcePluginId: 'tps-global-context-menu' },
  }]);
  assert.equal(harness.events.workspace.length, 1);
  assert.equal(harness.events.workspace[0].name, 'tps:gcm-canvas-properties-updated');
  assert.deepEqual(harness.events.workspace[0].args[1], persisted.metadata.frontmatter);
});

test('atomic canvas mutation preserves an own __proto__ JSON property without mutating object prototypes', async () => {
  const original = JSON.parse('{"nodes":[],"edges":[],"metadata":{"version":"1.0-1.0","frontmatter":{"status":"open","__proto__":{"retained":true}}}}');
  const harness = createCanvasHarness(original);
  const service = new CanvasPropertiesService(harness.plugin);

  assert.equal(await service.process(harness.file, (frontmatter) => {
    frontmatter.status = 'done';
  }), true);

  const persisted = JSON.parse(harness.getContent());
  assert.equal(Object.prototype.hasOwnProperty.call(persisted.metadata.frontmatter, '__proto__'), true);
  assert.deepEqual(persisted.metadata.frontmatter.__proto__, { retained: true });
  assert.equal(Object.getPrototypeOf(persisted.metadata.frontmatter), Object.prototype);
  assert.equal({}.retained, undefined);
});

test('canvas reads are deeply isolated from metadata-cache objects', () => {
  const cachedFrontmatter = {
    status: 'open',
    nested: { retain: true },
    tags: ['alpha'],
  };
  const harness = createCanvasHarness({
    nodes: [],
    edges: [],
    metadata: { version: '1.0-1.0', frontmatter: cachedFrontmatter },
  }, { cachedFrontmatter });
  const service = new CanvasPropertiesService(harness.plugin);

  const first = service.read(harness.file);
  first.nested.retain = false;
  first.tags.push('mutated');

  assert.deepEqual(service.read(harness.file), cachedFrontmatter);
  assert.deepEqual(cachedFrontmatter, {
    status: 'open',
    nested: { retain: true },
    tags: ['alpha'],
  });
});

test('canvas writes fail closed when readable metadata-cache compatibility is unavailable', async () => {
  const source = {
    nodes: [],
    edges: [],
    metadata: { version: '1.0-1.0', frontmatter: { status: 'open' } },
  };
  const harness = createCanvasHarness(source, { cacheAvailable: false });
  const service = new CanvasPropertiesService(harness.plugin);

  assert.equal(await service.process(harness.file, (frontmatter) => {
    frontmatter.status = 'done';
  }), false);
  assert.deepEqual(JSON.parse(harness.getContent()), source);
  assert.deepEqual(harness.calls, { modify: 0, process: 0, read: 0, writes: 0 });
});

test('canvas capability requires the Advanced Canvas cache signature rather than a cache/frontmatter object', async () => {
  const source = {
    nodes: [],
    edges: [],
    metadata: { version: '1.0-1.0', frontmatter: { status: 'open' } },
  };
  const harness = createCanvasHarness(source, {
    cacheSignatureValid: false,
    cachedFrontmatter: { status: 'open' },
  });
  const service = new CanvasPropertiesService(harness.plugin);

  assert.equal(await service.process(harness.file, (frontmatter) => {
    frontmatter.status = 'must-not-write';
  }), false);
  assert.deepEqual(JSON.parse(harness.getContent()), source);
  assert.equal(harness.calls.process, 0);
});

test('current Canvas metadata can receive its first frontmatter property when compatibility indexing is proven', async () => {
  const source = {
    nodes: [],
    edges: [],
    metadata: { version: '1.0-1.0', retained: { owner: 'advanced-canvas' } },
  };
  const harness = createCanvasHarness(source, { cachedFrontmatter: undefined });
  const service = new CanvasPropertiesService(harness.plugin);

  assert.deepEqual(service.read(harness.file), {});
  assert.equal(await service.process(harness.file, (frontmatter) => {
    frontmatter.status = 'active';
  }), true);

  const persisted = JSON.parse(harness.getContent());
  assert.deepEqual(persisted.metadata, {
    version: '1.0-1.0',
    retained: { owner: 'advanced-canvas' },
    frontmatter: { status: 'active' },
  });
  assert.deepEqual(service.read(harness.file), { status: 'active' });
});

test('pending Canvas reads survive stat-before-cache refresh and are scoped to TFile identity', async () => {
  const harness = createCanvasHarness({
    nodes: [],
    edges: [],
    metadata: { version: '1.0-1.0', frontmatter: { status: 'open' } },
  }, { cachedFrontmatter: { status: 'open' } });
  const service = new CanvasPropertiesService(harness.plugin);

  assert.equal(await service.process(harness.file, (frontmatter) => {
    frontmatter.status = 'done';
  }), true);
  assert.equal(harness.file.stat.mtime, 2);
  assert.deepEqual(service.read(harness.file), { status: 'done' });

  // Advanced Canvas can publish a queued pre-write index after the file stat
  // changes. It must not make an immediate read regress to the old value.
  harness.emitMetadataChanged({ status: 'open' });
  assert.deepEqual(service.read(harness.file), { status: 'done' });

  const originalPath = harness.file.path;
  harness.file.path = 'Boards/Renamed.canvas';
  const replacementAtOldPath = {
    path: originalPath,
    extension: 'canvas',
    basename: 'Atomic',
    stat: { mtime: 20 },
  };
  assert.deepEqual(service.read(harness.file), { status: 'done' });
  assert.deepEqual(service.read(replacementAtOldPath), { status: 'open' });

  harness.emitMetadataChanged({ status: 'done' }, harness.file);
  assert.deepEqual(service.read(harness.file), { status: 'done' });
  assert.equal(harness.registeredEvents.length, 2);
});

test('a later compatible Canvas cache revision supersedes a pending committed read', async () => {
  const harness = createCanvasHarness({
    nodes: [],
    edges: [],
    metadata: { version: '1.0-1.0', frontmatter: { status: 'open' } },
  }, { cachedFrontmatter: { status: 'open' } });
  const service = new CanvasPropertiesService(harness.plugin);

  assert.equal(await service.process(harness.file, (frontmatter) => {
    frontmatter.status = 'done';
  }), true);
  harness.emitMetadataChanged({ status: 'external-later' });
  assert.deepEqual(service.read(harness.file), { status: 'external-later' });
});

test('concurrent canvas writers serialize against the latest durable revision instead of stale metadata cache state', async () => {
  const harness = createCanvasHarness({
    nodes: [{ id: 'external-node', type: 'text', text: 'Concurrent content' }],
    edges: [],
    metadata: {
      version: '1.0-1.0',
      frontmatter: { external: 'winner' },
    },
  }, {
    cachedFrontmatter: { stale: 'must-not-return' },
  });
  const service = new CanvasPropertiesService(harness.plugin);

  const [first, second] = await Promise.all([
    service.process(harness.file, (frontmatter) => {
      frontmatter.status = 'active';
    }),
    service.process(harness.file, (frontmatter) => {
      frontmatter.priority = 'high';
    }),
  ]);

  assert.deepEqual([first, second], [true, true]);
  assert.deepEqual(harness.calls, { modify: 0, process: 2, read: 0, writes: 2 });
  const persisted = JSON.parse(harness.getContent());
  assert.deepEqual(persisted.nodes, [{ id: 'external-node', type: 'text', text: 'Concurrent content' }]);
  assert.deepEqual(persisted.metadata.frontmatter, {
    status: 'active',
    priority: 'high',
    external: 'winner',
  });
  assert.equal('stale' in persisted.metadata.frontmatter, false);
  assert.deepEqual(service.read(harness.file), persisted.metadata.frontmatter);
});

test('canvas metadata version is preserved only when the owning schema is already current', async () => {
  const harness = createCanvasHarness({
    nodes: [],
    edges: [],
    metadata: { version: '1.0-1.0', frontmatter: { status: 'open' } },
  });
  const service = new CanvasPropertiesService(harness.plugin);
  assert.equal(await service.process(harness.file, (frontmatter) => {
    frontmatter.status = 'done';
  }), true);
  assert.equal(JSON.parse(harness.getContent()).metadata.version, '1.0-1.0');
});

test('canvas mutation fails closed on malformed JSON, unsupported versions, and invalid document shapes', async () => {
  const cases = [
    ['malformed JSON', '{"nodes":['],
    ['array document', '[]'],
    ['non-finite root number', '{"nodes":[],"edges":[],"weight":1e400,"metadata":{"version":"1.0-1.0","frontmatter":{}}}'],
    ['non-finite node number', '{"nodes":[{"id":"n1","x":1e400}],"edges":[],"metadata":{"version":"1.0-1.0","frontmatter":{}}}'],
    ['null nodes', '{"nodes":null,"edges":[],"metadata":{"version":"1.0-1.0","frontmatter":{}}}'],
    ['object edges', '{"nodes":[],"edges":{},"metadata":{"version":"1.0-1.0","frontmatter":{}}}'],
    ['null metadata', '{"nodes":[],"edges":[],"metadata":null}'],
    ['array metadata', '{"nodes":[],"edges":[],"metadata":[]}'],
    ['missing metadata', '{"nodes":[],"edges":[],"legacyField":true}'],
    ['missing version', '{"nodes":[],"edges":[],"metadata":{"frontmatter":{},"custom":{"retained":true}}}'],
    ['null frontmatter', '{"nodes":[],"edges":[],"metadata":{"version":"1.0-1.0","frontmatter":null}}'],
    ['array frontmatter', '{"nodes":[],"edges":[],"metadata":{"version":"1.0-1.0","frontmatter":[]}}'],
    ['legacy version', '{"nodes":[],"edges":[],"metadata":{"version":"1.0","frontmatter":{}}}'],
    ['future version', '{"nodes":[],"edges":[],"metadata":{"version":"2.0-1.0","frontmatter":{}}}'],
    ['null version', '{"nodes":[],"edges":[],"metadata":{"version":null,"frontmatter":{}}}'],
  ];

  for (const [label, source] of cases) {
    const harness = createCanvasHarness(source, { cachedFrontmatter: {} });
    const service = new CanvasPropertiesService(harness.plugin);
    const changed = await service.process(harness.file, (frontmatter) => {
      frontmatter.status = label;
    });
    assert.equal(changed, false, label);
    assert.equal(harness.getContent(), source, label);
    assert.deepEqual(harness.calls, { modify: 0, process: 1, read: 0, writes: 0 }, label);
    assert.deepEqual(harness.events, { explicit: [], filesUpdated: [], workspace: [] }, label);
  }
});

test('canvas no-ops preserve exact bytes and ordinary writer failures remain observable', async (t) => {
  const raw = '{"nodes":[],"edges":[],"metadata":{"version":"1.0-1.0","frontmatter":{"status":"open"}}}\n';

  await t.test('no-op', async () => {
    const harness = createCanvasHarness(raw, { cachedFrontmatter: { status: 'open' } });
    const service = new CanvasPropertiesService(harness.plugin);
    assert.equal(await service.process(harness.file, (frontmatter) => {
      frontmatter.status = 'open';
    }), false);
    assert.equal(harness.getContent(), raw);
    assert.deepEqual(harness.calls, { modify: 0, process: 1, read: 0, writes: 0 });
  });

  await t.test('mutator throw', async () => {
    const harness = createCanvasHarness(raw, { cachedFrontmatter: { status: 'open' } });
    const service = new CanvasPropertiesService(harness.plugin);
    await assert.rejects(
      service.process(harness.file, () => {
        throw new Error('mutator failed');
      }),
      /mutator failed/,
    );
    assert.equal(harness.getContent(), raw);
    assert.equal(harness.calls.writes, 0);
  });

  await t.test('Vault.process rejection', async () => {
    const harness = createCanvasHarness(raw, {
      cachedFrontmatter: { status: 'open' },
      processError: new Error('vault rejected'),
    });
    const service = new CanvasPropertiesService(harness.plugin);
    await assert.rejects(
      service.process(harness.file, (frontmatter) => {
        frontmatter.status = 'done';
      }),
      /vault rejected/,
    );
    assert.equal(harness.getContent(), raw);
    assert.equal(harness.calls.writes, 0);
  });
});

test('typed canvas outcomes distinguish durable, no-op, guarded, refused, and unsupported paths', async () => {
  const raw = '{"nodes":[],"edges":[],"metadata":{"version":"1.0-1.0","frontmatter":{"status":"open"}}}\n';
  const harness = createCanvasHarness(raw);
  const service = new CanvasPropertiesService(harness.plugin);

  assert.equal(await service.processWithOutcome(harness.file, (frontmatter) => {
    frontmatter.status = 'done';
  }), 'changed');
  assert.equal(await service.processWithOutcome(harness.file, (frontmatter) => {
    frontmatter.status = 'done';
  }), 'unchanged');
  assert.equal(await service.processGuardedWithOutcome(harness.file, () => false), 'guarded-abort');

  const malformed = createCanvasHarness('{"nodes":[', { cachedFrontmatter: {} });
  assert.equal(await new CanvasPropertiesService(malformed.plugin).processWithOutcome(malformed.file, () => {}), 'parse-failed');

  const unavailable = createCanvasHarness(raw, { cacheAvailable: false });
  assert.equal(await new CanvasPropertiesService(unavailable.plugin).processWithOutcome(unavailable.file, () => {}), 'unsupported');
});

test('post-commit listener failure cannot suppress later Canvas notifications or durable success', async () => {
  const harness = createCanvasHarness({
    nodes: [],
    edges: [],
    metadata: { version: '1.0-1.0', frontmatter: { status: 'open' } },
  }, { explicitEventError: new Error('listener failed') });
  const service = new CanvasPropertiesService(harness.plugin);

  assert.equal(await service.process(harness.file, (frontmatter) => {
    frontmatter.status = 'done';
  }), true);
  assert.equal(harness.calls.writes, 1);
  assert.equal(harness.events.explicit.length, 1);
  assert.equal(harness.events.filesUpdated.length, 1);
  assert.equal(harness.events.workspace.length, 1);
});

test('canvas mutation refuses async mutators and invalid JSON postconditions before a durable write', async (t) => {
  const source = {
    nodes: [],
    edges: [],
    metadata: { version: '1.0-1.0', frontmatter: { status: 'open' } },
  };

  await t.test('async mutator', async () => {
    const harness = createCanvasHarness(source);
    const service = new CanvasPropertiesService(harness.plugin);
    const changed = await service.process(harness.file, async (frontmatter) => {
      frontmatter.status = 'must-not-persist';
      await Promise.resolve();
      frontmatter.late = true;
    });
    await Promise.resolve();
    assert.equal(changed, false);
    assert.deepEqual(JSON.parse(harness.getContent()), source);
    assert.equal(harness.calls.writes, 0);
  });

  await t.test('non-JSON nested value', async () => {
    const harness = createCanvasHarness(source);
    const service = new CanvasPropertiesService(harness.plugin);
    const changed = await service.process(harness.file, (frontmatter) => {
      frontmatter.invalid = { nested: undefined };
    });
    assert.equal(changed, false);
    assert.deepEqual(JSON.parse(harness.getContent()), source);
    assert.equal(harness.calls.writes, 0);
  });
});

test('frontmatter mutation service routes canvas files through canvas properties', () => {
  const service = read('src/services/frontmatter-mutation-service.ts');
  const bulkEdit = read('src/services/bulk-edit-service.ts');
  assert.match(service, /canvasPropertiesService\?\.isCanvasFile\(file\)/);
  assert.match(service, /canvasPropertiesService\?\.updateValues\(canvasFiles, updates\)/);
  assert.match(service, /canvasPropertiesService\?\.setListValues\(canvasFiles, key, values\)/);
  assert.match(service, /canvasPropertiesService\?\.deleteKeys\(canvasFiles, normalizedKeys\)/);
  assert.match(bulkEdit, /extension !== 'md' && !this\.plugin\.canvasPropertiesService\?\.isCanvasFile\(file\)/);
  assert.match(bulkEdit, /extension === 'md' && !\(await this\.canMutateFrontmatterSafely\(file\)\)/);
});

test('notebook navigator rules can write icon properties to canvas files', () => {
  const service = read('src/services/notebook-navigator-rule-service.ts');
  const events = read('src/events/register-events.ts');
  const main = read('src/main.ts');
  const api = read('src/plugin-api.ts');

  assert.match(service, /canApplyToFile\(file: unknown\): file is TFile/);
  assert.match(service, /extension === 'md' \|\| extension === 'canvas'/);
  assert.match(service, /this\.plugin\.app\.vault\.getFiles\(\)\.filter\(\(file\): file is TFile => this\.canApplyToFile\(file\)\)/);
  assert.match(service, /this\.plugin\.frontmatterMutationService\.process\(file, \(frontmatter\) =>/);
  assert.match(service, /canvasPropertiesService\.read\(file\)/);
  assert.doesNotMatch(service, /applyRulesToFile\(file: TFile[\s\S]{0,120}file\.extension !== 'md'/);
  assert.match(events, /notebookNavigatorRuleService\.scheduleApply\(file,\s*\{\s*reason: 'create'/);
  assert.match(events, /notebookNavigatorRuleService\.scheduleApply\(liveFile,\s*\{\s*reason: 'rename'/);
  assert.match(main, /No active markdown or canvas file/);
  assert.match(api, /notebookNavigatorRuleService\.canApplyToFile\(file\)/);
});

test('vault query API can opt into canvas files asynchronously', () => {
  const service = read('src/services/vault-query-service.ts');
  const api = read('src/plugin-api.ts');
  assert.match(service, /includeCanvasFiles\?: boolean/);
  assert.match(service, /extension === 'md' \|\| extension === 'canvas'/);
  assert.match(service, /count\(criteria: VaultQueryCriteria = \{\}\): number \{\s*const files = this\.getCandidateFiles\(criteria\);/);
  assert.match(service, /canvasPropertiesService\.read\(file\)/);
  assert.match(api, /canvasProperties: canvasPropertiesApi/);
  assert.match(api, /getFileAsync/);
});

test('native GCM property menus include canvas files but keep note conversion markdown-only', () => {
  const menu = read('src/menu/menu-builder.ts');
  const controller = read('src/menu/menu-controller.ts');
  const contextTargets = read('src/services/context-target-service.ts');
  assert.match(menu, /extension === 'md' \|\| extension === 'canvas'/);
  assert.match(menu, /const propertyEntries = entries\.filter\(\(entry\) => this\.isPropertyFile\(entry\.file\)\)/);
  assert.match(menu, /resolveCustomProperties\(this\.plugin\.settings\.properties \|\| \[\], propertyEntries/);
  assert.match(menu, /convertNotesToCanvases\(markdownFiles\)/);
  assert.match(controller, /extension === 'md' \|\| extension === 'canvas'/);
  assert.match(contextTargets, /extension === 'md' \|\| extension === 'canvas'/);
  assert.match(contextTargets, /\$\{raw\}\.canvas/);
});

test('async vault queries can filter canvas files by node content', () => {
  const service = read('src/services/vault-query-service.ts');
  assert.match(service, /export interface ContentQueryFilter/);
  assert.match(service, /content\?: ContentQueryFilter/);
  assert.match(service, /matchesContentFilterAsync\(file, criteria\.content\)/);
  assert.match(service, /JSON\.parse\(content \|\| '\{\}'\)/);
  assert.match(service, /getCanvasNodeSearchText\(parsed, filter\.canvasNodeTypes\)/);
  assert.match(service, /type === 'text'[\s\S]*record\.text/);
  assert.match(service, /type === 'file'[\s\S]*record\.file[\s\S]*record\.subpath/);
  assert.match(service, /type === 'group'[\s\S]*record\.label/);
  assert.match(service, /type === 'link'[\s\S]*record\.url/);
  assert.match(service, /if \(criteria\.content && !options\.allowContentRead\) return null/);
});

test('note to canvas conversion copies frontmatter into Advanced Canvas metadata', () => {
  const service = read('src/services/note-operation-service.ts');
  const api = read('src/plugin-api.ts');
  const menu = read('src/menu/menu-builder.ts');
  assert.match(service, /async convertNotesToCanvases\(files: TFile\[\], options: NoteToCanvasOptions = \{\}\): Promise<TFile\[\]>/);
  assert.match(service, /async createCanvasFromNote\(file: TFile, options: NoteToCanvasOptions = \{\}\): Promise<TFile \| null>/);
  assert.match(service, /const frontmatter = this\.cloneFrontmatterObject\(parts\.frontmatter \|\| \{\}\)/);
  assert.match(service, /metadata:\s*\{\s*version: "1\.0-1\.0",\s*frontmatter,/);
  assert.match(service, /type: "text"[\s\S]*text,/);
  assert.match(service, /this\.app\.vault\.create\(targetPath, `\$\{JSON\.stringify\(document, null, 2\)\}\\n`\)/);
  assert.doesNotMatch(service, /archiveSourceNotes\(createdFiles/);
  assert.match(api, /convertNotesToCanvases/);
  assert.match(api, /createCanvasFromNote/);
  assert.match(menu, /Convert to canvas/);
  assert.match(menu, /convertNotesToCanvases\(markdownFiles\)/);
});
