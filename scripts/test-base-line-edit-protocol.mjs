import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const serviceSource = readFileSync(
  new URL('../src/services/base-line-edit-protocol-service.ts', import.meta.url),
  'utf8',
);
const homeCaptureSource = readFileSync(
  new URL('../src/services/home-capture-service.ts', import.meta.url),
  'utf8',
);
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

async function loadModule(entry) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian-stub',
          namespace: 'obsidian-stub',
        }));
        builder.onLoad({ filter: /.*/u, namespace: 'obsidian-stub' }, () => ({
          contents: `
            export class TFile {
              constructor(path) {
                this.path = path;
                this.extension = path.split('.').pop();
                this.basename = path.split('/').pop().replace(/\\.[^.]+$/, '');
              }
              static [Symbol.hasInstance](value) {
                return Boolean(value && typeof value.path === 'string' && typeof value.extension === 'string');
              }
            }
            export class Notice {
              constructor(message) {
                globalThis.__baseLineNotices = [...(globalThis.__baseLineNotices || []), message];
              }
            }
            export function normalizePath(path) { return String(path || '').replace(/\\\\/g, '/'); }
            export function parseYaml(value) { return JSON.parse(value); }
          `,
          loader: 'js',
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const core = await loadModule('../src/services/base-line-edit-protocol-core.ts');
const { BaseLineEditProtocolService } = await loadModule('../src/services/base-line-edit-protocol-service.ts');

function sha256(value) {
  return createHash('sha256').update(String(value).normalize('NFC')).digest('hex');
}

function makeParams(overrides = {}) {
  return {
    v: '1',
    vault: 'Obsidian Plugin Test Vault',
    base: 'Bases/Inbox.base',
    view: 'Inbox',
    source: 'Inbox/Tasks.md',
    line: '2',
    fingerprint: sha256('- [ ] Exact task'),
    nonce: '123e4567-e89b-12d3-a456-426614174000',
    ...overrides,
  };
}

function createHarness({
  source = 'Heading\n- [ ] Exact task\nTail',
  view = 'Inbox',
  basePath = 'Bases/Inbox.base',
  sourcePath = 'Inbox/Tasks.md',
  baseContent = null,
  openLineEditor,
} = {}) {
  const baseFile = { path: basePath, extension: basePath.split('.').pop(), basename: 'Inbox' };
  const sourceFile = { path: sourcePath, extension: sourcePath.split('.').pop(), basename: 'Tasks' };
  const sequence = [];
  const modalCalls = [];
  let protocolRegistration = null;
  const plugin = {
    registerObsidianProtocolHandler(action, handler) {
      protocolRegistration = { action, handler };
    },
    app: {
      vault: {
        getName: () => 'Obsidian Plugin Test Vault',
        getAbstractFileByPath(path) {
          if (path === baseFile.path) return baseFile;
          if (path === sourceFile.path) return sourceFile;
          return null;
        },
        async cachedRead(file) {
          sequence.push(`cached:${file.extension}`);
          return baseContent ?? JSON.stringify({ views: [{ type: 'table', name: view }] });
        },
        async read(file) {
          sequence.push(`read:${file.extension}`);
          return source;
        },
      },
      workspace: {
        async openLinkText(link, from, newLeaf) {
          sequence.push('open-base');
          assert.equal(link, `${baseFile.path}#${view}`);
          assert.equal(from, '');
          assert.equal(newLeaf, false);
        },
      },
    },
    homeCaptureService: {
      async openLineEditor(file, line, options) {
        sequence.push('open-modal');
        modalCalls.push({ file, line, options });
        if (openLineEditor) return openLineEditor(file, line, options);
        return false;
      },
    },
  };
  return {
    plugin,
    sequence,
    modalCalls,
    getRegistration: () => protocolRegistration,
  };
}

test('protocol validates exactly the allow-listed bounded version-1 payload', () => {
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams()).ok, true);
  assert.deepEqual(
    core.validateBaseLineEditProtocolParams({ ...makeParams(), command: 'unsafe' }),
    { ok: false, reason: 'invalid-keys' },
  );
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ v: '2' })).ok, false);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ vault: 'v'.repeat(160) })).ok, true);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ vault: 'v'.repeat(161) })).ok, false);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ base: '../Inbox.base' })).ok, false);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ base: 'Bases/Inbox.BASE' })).ok, true);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ base: 'Bases/Open & Waiting?.base' })).ok, true);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ source: 'Inbox/Tasks.md#Heading' })).ok, false);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ source: 'Inbox/Tasks.MD' })).ok, true);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ source: 'Inbox/Open & Waiting?.md' })).ok, true);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ view: 'Bad#View' })).ok, false);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ view: 'Open & Waiting?' })).ok, true);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ line: '0' })).ok, false);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ line: '2097153' })).ok, false);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ fingerprint: 'A'.repeat(64) })).ok, false);
  assert.equal(core.validateBaseLineEditProtocolParams(makeParams({ nonce: 'not-a-uuid' })).ok, false);
});

test('fingerprints use lowercase SHA-256 over NFC-normalized physical lines', async () => {
  const composed = 'Café task';
  const decomposed = 'Cafe\u0301 task';
  assert.equal(await core.sha256BaseLine(decomposed), sha256(composed));
  assert.match(await core.sha256BaseLine(composed), /^[0-9a-f]{64}$/u);
});

test('only physical line one ignores a leading UTF-8 BOM for app-compatible fingerprints', async () => {
  assert.deepEqual(
    await core.resolveUniqueBaseLineFingerprint('\uFEFFFirst line\nSecond line', sha256('First line'), 1),
    { status: 'unique', zeroBasedLine: 0, relocated: false },
  );
  assert.deepEqual(
    await core.resolveUniqueBaseLineFingerprint('First line\n\uFEFFSecond line', sha256('Second line'), 2),
    { status: 'missing' },
  );
  assert.deepEqual(
    await core.resolveUniqueBaseLineFingerprint('First line\n\uFEFFSecond line', sha256('\uFEFFSecond line'), 2),
    { status: 'unique', zeroBasedLine: 1, relocated: false },
  );
});

test('line resolution follows a stale hint only when one current fingerprint match exists', async () => {
  const line = '- [ ] Exact task';
  const fingerprint = sha256(line);
  assert.deepEqual(
    await core.resolveUniqueBaseLineFingerprint(`Inserted\r\nHeading\r\n${line}\r\nTail`, fingerprint, 2),
    { status: 'unique', zeroBasedLine: 2, relocated: true },
  );
  assert.deepEqual(
    await core.resolveUniqueBaseLineFingerprint(`${line}\nOther\n${line}`, fingerprint, 1),
    { status: 'ambiguous' },
  );
  assert.deepEqual(
    await core.resolveUniqueBaseLineFingerprint('Other only', fingerprint, 1),
    { status: 'missing' },
  );
});

test('handler opens the exact existing Base view before resolving and opening the guarded editor', async () => {
  const source = 'Inserted\nHeading\n- [ ] Exact task\nTail';
  const view = 'Open & Waiting?';
  const harness = createHarness({ source, view });
  const service = new BaseLineEditProtocolService(harness.plugin);
  service.register();
  assert.equal(harness.getRegistration().action, 'tps-gcm-edit-base-line');

  const handled = await service.handleProtocolData({
    action: 'tps-gcm-edit-base-line',
    ...makeParams({ view }),
  });

  assert.equal(handled, true);
  assert.deepEqual(harness.sequence, ['cached:base', 'open-base', 'read:md', 'open-modal']);
  assert.equal(harness.modalCalls.length, 1);
  assert.equal(harness.modalCalls[0].file.path, 'Inbox/Tasks.md');
  assert.equal(harness.modalCalls[0].line, 2);
  assert.deepEqual(harness.modalCalls[0].options, {
    expectedFingerprint: makeParams().fingerprint,
    redactDiagnostics: true,
  });
});

test('registered protocol data accepts only the implicit matching action plus exact query keys', async () => {
  const harness = createHarness();
  const service = new BaseLineEditProtocolService(harness.plugin);
  assert.equal(await service.handleProtocolData({
    action: 'tps-gcm-edit-base-line',
    ...makeParams(),
  }), true);
  assert.equal(await service.handleProtocolData({
    action: 'another-action',
    ...makeParams({ nonce: '123e4567-e89b-12d3-a456-426614174001' }),
  }), false);
  assert.equal(await service.handleProtocolData({
    action: 'tps-gcm-edit-base-line',
    ...makeParams({ nonce: '123e4567-e89b-12d3-a456-426614174002' }),
    extra: 'unsafe',
  }), false);
});

test('uppercase extensions and percent-decoded path characters remain exact through the Base-view route', async () => {
  const harness = createHarness({
    basePath: 'Bases/Open & Waiting?.BASE',
    sourcePath: 'Inbox/Open & Waiting?.MD',
  });
  const service = new BaseLineEditProtocolService(harness.plugin);
  assert.equal(await service.handle(makeParams({
    base: 'Bases/Open & Waiting?.BASE',
    source: 'Inbox/Open & Waiting?.MD',
  })), true);
  assert.equal(harness.modalCalls.length, 1);
});

test('oversized Base definitions and Markdown sources fail before parse or hashing', async () => {
  const oversizedBase = createHarness({ baseContent: 'x'.repeat((512 * 1024) + 1) });
  const baseService = new BaseLineEditProtocolService(oversizedBase.plugin);
  assert.equal(await baseService.handle(makeParams()), false);
  assert.deepEqual(oversizedBase.sequence, ['cached:base']);

  const oversizedSource = createHarness({ source: 'x'.repeat((2 * 1024 * 1024) + 1) });
  const sourceService = new BaseLineEditProtocolService(oversizedSource.plugin);
  assert.equal(await sourceService.handle(makeParams()), false);
  assert.deepEqual(oversizedSource.sequence, ['cached:base', 'open-base', 'read:md']);
  assert.equal(oversizedSource.modalCalls.length, 0);

  assert.equal(core.isWithinUtf8ByteLimit('é'.repeat(2), 4), true);
  assert.equal(core.isWithinUtf8ByteLimit('é'.repeat(3), 4), false);
});

test('handler fails closed before opening for wrong vault, missing or duplicate view, or ambiguous line', async () => {
  globalThis.__baseLineNotices = [];
  const wrongVaultHarness = createHarness();
  const wrongVault = new BaseLineEditProtocolService(wrongVaultHarness.plugin);
  assert.equal(await wrongVault.handle(makeParams({ vault: 'Another Vault' })), false);
  assert.deepEqual(wrongVaultHarness.sequence, []);

  const missingViewHarness = createHarness({ view: 'Another view' });
  const missingView = new BaseLineEditProtocolService(missingViewHarness.plugin);
  assert.equal(await missingView.handle(makeParams()), false);
  assert.deepEqual(missingViewHarness.sequence, ['cached:base']);

  const duplicateViewHarness = createHarness({
    baseContent: JSON.stringify({
      views: [
        { type: 'table', name: 'Inbox' },
        { type: 'list', name: 'Inbox' },
      ],
    }),
  });
  const duplicateView = new BaseLineEditProtocolService(duplicateViewHarness.plugin);
  assert.equal(await duplicateView.handle(makeParams()), false);
  assert.deepEqual(duplicateViewHarness.sequence, ['cached:base']);

  const line = '- [ ] Exact task';
  const ambiguousHarness = createHarness({ source: `${line}\n${line}` });
  const ambiguous = new BaseLineEditProtocolService(ambiguousHarness.plugin);
  assert.equal(await ambiguous.handle(makeParams({ line: '1' })), false);
  assert.deepEqual(ambiguousHarness.sequence, ['cached:base', 'open-base', 'read:md']);
  assert.equal(ambiguousHarness.modalCalls.length, 0);
  assert.ok(globalThis.__baseLineNotices.length >= 4);
});

test('handler deduplicates one nonce while active and during the recent replay window', async () => {
  let releaseModal;
  let modalStartedResolve;
  const modalStarted = new Promise((resolve) => { modalStartedResolve = resolve; });
  const harness = createHarness({
    openLineEditor: () => {
      modalStartedResolve();
      return new Promise((resolve) => { releaseModal = resolve; });
    },
  });
  const service = new BaseLineEditProtocolService(harness.plugin);
  const params = makeParams();
  const first = service.handle(params);
  await modalStarted;

  assert.equal(await service.handle(params), false);
  releaseModal(false);
  assert.equal(await first, true);
  assert.equal(await service.handle(params), false);
  assert.equal(harness.modalCalls.length, 1);
});

test('recent replay memory remains capped after pruning', async () => {
  const harness = createHarness();
  const service = new BaseLineEditProtocolService(harness.plugin);
  for (let index = 0; index < 257; index += 1) {
    const nonce = `00000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}`;
    assert.equal(await service.handle(makeParams({ nonce })), true);
  }
  assert.equal(service.recentNonces.size, 256);
});

test('route logging is redacted and the editor rechecks the digest before any Save mutation', () => {
  assert.doesNotMatch(serviceSource, /logger\.[^(]+\([^\n]*params\.(?:vault|base|view|source|line|fingerprint|nonce)/u);
  assert.match(serviceSource, /expectedFingerprint: params\.fingerprint/u);
  assert.match(serviceSource, /redactDiagnostics: true/u);
  assert.match(homeCaptureSource, /const actualFingerprint = await sha256BaseLine/u);
  assert.match(homeCaptureSource, /zeroBasedLine === 0/u);
  assert.match(homeCaptureSource, /MAX_BASE_LINE_SOURCE_BYTES/u);
  assert.match(homeCaptureSource, /resolveUniqueBaseLineFingerprint\([\s\S]*?this\.expectedFingerprint/u);
  assert.match(homeCaptureSource, /await this\.plugin\.app\.vault\.read\(this\.file\)[\s\S]*?await this\.plugin\.app\.vault\.process/u);
  assert.match(homeCaptureSource, /replaceHomeCaptureRangeIfUnchanged/u);
  assert.match(mainSource, /new BaseLineEditProtocolService\(this\)[\s\S]*?baseLineEditProtocolService\.register\(\)/u);
  assert.doesNotMatch(serviceSource, /logger\.flowError/u);
  assert.match(homeCaptureSource, /if \(this\.redactDiagnostics\)[\s\S]*?logger\.flowWarn\('HomeCapture', 'line-editor:digest-check-failed'/u);
});
