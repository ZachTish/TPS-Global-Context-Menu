import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadArchiveServiceModule() {
  const result = await build({
    stdin: {
      contents: `
        export {
          ArchiveFileService,
          getArchiveRelativeOriginalFolder,
        } from '../src/services/archive-file-service.ts';
        export { TFile, TFolder } from 'obsidian';
      `,
      resolveDir: fileURLToPath(new URL('.', import.meta.url)),
      sourcefile: 'archive-file-service-harness.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins: [{
      name: 'obsidian-stub',
      setup(builder) {
        builder.onResolve({ filter: /^obsidian$/u }, () => ({
          path: 'obsidian',
          namespace: 'archive-file-service-test',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'archive-file-service-test' }, () => ({
          loader: 'js',
          contents: `
            export class TAbstractFile {
              constructor(path = '') {
                this.path = path;
                this.name = path.split('/').filter(Boolean).pop() || '';
                this.parent = null;
              }
            }
            export class TFolder extends TAbstractFile {
              constructor(path = '') {
                super(path);
                this.children = [];
              }
            }
            export class TFile extends TAbstractFile {
              constructor(path = '') {
                super(path);
                this.extension = this.name.includes('.') ? this.name.split('.').pop() : '';
                this.basename = this.extension
                  ? this.name.slice(0, -(this.extension.length + 1))
                  : this.name;
                this.stat = { ctime: 0, mtime: 0, size: 0 };
              }
            }
            export class Notice {
              constructor(message) {
                globalThis.__archiveNotices = [
                  ...(globalThis.__archiveNotices || []),
                  String(message),
                ];
              }
            }
            export function normalizePath(value) {
              return String(value || '')
                .replace(/\\\\/g, '/')
                .replace(/\\/{2,}/g, '/')
                .replace(/^\\.\\//, '')
                .replace(/\\/$/g, '');
            }
          `,
        }));
      },
    }],
  });

  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const {
  ArchiveFileService,
  TFile,
  TFolder,
  getArchiveRelativeOriginalFolder,
} = await loadArchiveServiceModule();

function normalizeTestPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/g, '');
}

function createArchiveHarness({
  archiveFolder = '_archive',
  archiveTag = 'archive',
  files = [],
  failMetadataFor = [],
  returnFalseMetadataFor = [],
  failRenameFrom = [],
} = {}) {
  const entries = new Map();
  const frontmatterByFile = new WeakMap();
  const processFrontMatterCalls = [];
  const nativeProcessFrontMatterCalls = [];
  const renameCalls = [];
  const queuedMoves = [];
  const failingMetadataPaths = new Set(failMetadataFor.map(normalizeTestPath));
  const falseMetadataPaths = new Set(returnFalseMetadataFor.map(normalizeTestPath));
  const failingRenamePaths = new Set(failRenameFrom.map(normalizeTestPath));
  const root = new TFolder('');
  entries.set('', root);

  function refreshFileIdentity(file, path) {
    const normalized = normalizeTestPath(path);
    const name = normalized.split('/').filter(Boolean).pop() || '';
    const extension = name.includes('.') ? name.split('.').pop() : '';
    file.path = normalized;
    file.name = name;
    file.extension = extension;
    file.basename = extension ? name.slice(0, -(extension.length + 1)) : name;
  }

  function ensureFolder(path) {
    const normalized = normalizeTestPath(path);
    if (!normalized) return root;
    const existing = entries.get(normalized);
    if (existing) {
      assert.ok(existing instanceof TFolder, `Expected "${normalized}" to be a folder`);
      return existing;
    }

    const parentPath = normalized.includes('/')
      ? normalized.slice(0, normalized.lastIndexOf('/'))
      : '';
    const parent = ensureFolder(parentPath);
    const folder = new TFolder(normalized);
    folder.parent = parent;
    parent.children.push(folder);
    entries.set(normalized, folder);
    return folder;
  }

  function addFile(path, frontmatter = {}) {
    const normalized = normalizeTestPath(path);
    const parentPath = normalized.includes('/')
      ? normalized.slice(0, normalized.lastIndexOf('/'))
      : '';
    const parent = ensureFolder(parentPath);
    const file = new TFile(normalized);
    file.parent = parent;
    parent.children.push(file);
    entries.set(normalized, file);
    frontmatterByFile.set(file, structuredClone(frontmatter));
    return file;
  }

  for (const descriptor of files) {
    if (typeof descriptor === 'string') {
      addFile(descriptor);
    } else {
      addFile(descriptor.path, descriptor.frontmatter || {});
    }
  }

  async function renameFile(file, targetPath) {
    const sourcePath = file.path;
    const normalizedTarget = normalizeTestPath(targetPath);
    if (failingRenamePaths.has(sourcePath)) {
      throw new Error(`Synthetic rename failure for ${sourcePath}`);
    }
    if (entries.has(normalizedTarget)) {
      throw new Error(`Target already exists: ${normalizedTarget}`);
    }
    const targetParentPath = normalizedTarget.includes('/')
      ? normalizedTarget.slice(0, normalizedTarget.lastIndexOf('/'))
      : '';
    const targetParent = ensureFolder(targetParentPath);
    entries.delete(sourcePath);
    if (file.parent instanceof TFolder) {
      file.parent.children = file.parent.children.filter((child) => child !== file);
    }
    refreshFileIdentity(file, normalizedTarget);
    file.parent = targetParent;
    targetParent.children.push(file);
    entries.set(normalizedTarget, file);
    renameCalls.push({ from: sourcePath, to: normalizedTarget });
  }

  async function processOwnedFrontmatter(file, mutator) {
    processFrontMatterCalls.push(file.path);
    if (failingMetadataPaths.has(file.path)) {
      throw new Error(`Synthetic frontmatter failure for ${file.path}`);
    }
    const frontmatter = structuredClone(frontmatterByFile.get(file) || {});
    await mutator(frontmatter);
    if (falseMetadataPaths.has(file.path)) {
      return false;
    }
    frontmatterByFile.set(file, frontmatter);
    return true;
  }

  const plugin = {
    settings: { archiveTag },
    frontmatterMutationService: {
      process: processOwnedFrontmatter,
    },
    app: {
      metadataCache: {
        getFileCache(file) {
          return { frontmatter: frontmatterByFile.get(file) || {} };
        },
      },
      vault: {
        getAbstractFileByPath(path) {
          return entries.get(normalizeTestPath(path)) || null;
        },
        async createFolder(path) {
          ensureFolder(path);
        },
        async rename(file, targetPath) {
          await renameFile(file, targetPath);
        },
      },
      fileManager: {
        async processFrontMatter(file) {
          nativeProcessFrontMatterCalls.push(file.path);
          throw new Error('Archive service bypassed the owned frontmatter mutation service.');
        },
        async renameFile(file, targetPath) {
          await renameFile(file, targetPath);
        },
      },
    },
    getArchiveFolderPath() {
      return archiveFolder;
    },
    async runQueuedMove(moveFiles, performMove) {
      queuedMoves.push(moveFiles.map((file) => file.path));
      await performMove();
      return true;
    },
  };

  return {
    plugin,
    entries,
    renameCalls,
    queuedMoves,
    processFrontMatterCalls,
    nativeProcessFrontMatterCalls,
    getFile(path) {
      const entry = entries.get(normalizeTestPath(path));
      return entry instanceof TFile ? entry : null;
    },
    getFrontmatter(file) {
      return frontmatterByFile.get(file) || {};
    },
  };
}

test('archives Markdown, Base, and Canvas files immediately while metadata stays Markdown-only', async () => {
  const harness = createArchiveHarness({
    files: [
      { path: 'Inbox/Note.md', frontmatter: { tags: ['active'] } },
      'Boards/Dashboard.base',
      'Maps/Plan.canvas',
    ],
  });
  const sourceFiles = [
    harness.getFile('Inbox/Note.md'),
    harness.getFile('Boards/Dashboard.base'),
    harness.getFile('Maps/Plan.canvas'),
  ];
  const service = new ArchiveFileService(harness.plugin);

  const result = await service.archiveFiles(sourceFiles, 'native-context-menu');

  assert.deepEqual(
    {
      requested: result.requested,
      moved: result.moved,
      tagged: result.tagged,
      skipped: result.skipped,
      failed: result.failed,
      metadataFailures: result.metadataFailures,
    },
    {
      requested: 3,
      moved: 3,
      tagged: 1,
      skipped: 0,
      failed: 0,
      metadataFailures: 0,
    },
  );
  assert.deepEqual(
    harness.renameCalls,
    [
      { from: 'Inbox/Note.md', to: '_archive/Inbox/Note.md' },
      { from: 'Boards/Dashboard.base', to: '_archive/Boards/Dashboard.base' },
      { from: 'Maps/Plan.canvas', to: '_archive/Maps/Plan.canvas' },
    ],
  );
  assert.ok(harness.getFile('_archive/Inbox/Note.md'));
  assert.ok(harness.getFile('_archive/Boards/Dashboard.base'));
  assert.ok(harness.getFile('_archive/Maps/Plan.canvas'));
  assert.deepEqual(harness.processFrontMatterCalls, ['Inbox/Note.md']);
  assert.deepEqual(harness.nativeProcessFrontMatterCalls, []);
  assert.deepEqual(
    harness.getFrontmatter(sourceFiles[0]),
    {
      tags: ['active', 'archive'],
      archiveOriginalFolder: 'Inbox',
    },
  );
  assert.deepEqual(harness.queuedMoves, [[
    'Inbox/Note.md',
    'Boards/Dashboard.base',
    'Maps/Plan.canvas',
  ]]);
});

test('a missing archive tag does not block immediate file movement', async () => {
  const harness = createArchiveHarness({
    archiveTag: '',
    files: ['Inbox/Untagged.md', 'Views/Tasks.base'],
  });
  const service = new ArchiveFileService(harness.plugin);

  const result = await service.archiveFiles([
    harness.getFile('Inbox/Untagged.md'),
    harness.getFile('Views/Tasks.base'),
  ], 'native-context-menu');

  assert.equal(result.moved, 2);
  assert.equal(result.tagged, 0);
  assert.ok(harness.getFile('_archive/Inbox/Untagged.md'));
  assert.ok(harness.getFile('_archive/Views/Tasks.base'));
  assert.equal(harness.renameCalls.length, 2);
  assert.deepEqual(harness.processFrontMatterCalls, []);
});

test('a Markdown metadata failure remains non-blocking for the archive move', async () => {
  const harness = createArchiveHarness({
    files: ['Inbox/Metadata failure.md'],
    failMetadataFor: ['Inbox/Metadata failure.md'],
  });
  const file = harness.getFile('Inbox/Metadata failure.md');
  const service = new ArchiveFileService(harness.plugin);

  const result = await service.archiveFiles([file], 'persistent-panel');

  assert.equal(result.moved, 1);
  assert.equal(result.metadataFailures, 1);
  assert.equal(result.failed, 0);
  assert.equal(harness.processFrontMatterCalls.length, 1);
  assert.ok(harness.getFile('_archive/Inbox/Metadata failure.md'));
  assert.deepEqual(harness.renameCalls, [{
    from: 'Inbox/Metadata failure.md',
    to: '_archive/Inbox/Metadata failure.md',
  }]);
});

test('nested paths are preserved and archive collisions receive the next numeric suffix', async () => {
  const harness = createArchiveHarness({
    files: [
      'Inbox/Projects/Roadmap.base',
      '_archive/Inbox/Projects/Roadmap.base',
      '_archive/Inbox/Projects/Roadmap 1.base',
    ],
  });
  const file = harness.getFile('Inbox/Projects/Roadmap.base');
  const service = new ArchiveFileService(harness.plugin);

  const result = await service.archiveFiles([file], 'native-context-menu');

  assert.equal(result.moved, 1);
  assert.ok(harness.getFile('_archive/Inbox/Projects/Roadmap 2.base'));
  assert.deepEqual(harness.renameCalls, [{
    from: 'Inbox/Projects/Roadmap.base',
    to: '_archive/Inbox/Projects/Roadmap 2.base',
  }]);
});

test('files already inside the archive folder are skipped without being nested or renamed', async () => {
  const harness = createArchiveHarness({
    files: ['_archive/Existing.canvas'],
  });
  const file = harness.getFile('_archive/Existing.canvas');
  const service = new ArchiveFileService(harness.plugin);

  const result = await service.archiveFiles([file], 'native-context-menu');

  assert.equal(result.moved, 0);
  assert.equal(result.skipped, 1);
  assert.equal(file.path, '_archive/Existing.canvas');
  assert.deepEqual(harness.renameCalls, []);
  assert.equal(harness.getFile('_archive/_archive/Existing.canvas'), null);
});

test('a missing archive folder fails closed without changing any file', async () => {
  const harness = createArchiveHarness({
    archiveFolder: '',
    files: ['Inbox/Keep.base'],
  });
  const file = harness.getFile('Inbox/Keep.base');
  const service = new ArchiveFileService(harness.plugin);

  const result = await service.archiveFiles([file], 'native-context-menu');

  assert.equal(result.moved, 0);
  assert.equal(result.failed, 1);
  assert.equal(file.path, 'Inbox/Keep.base');
  assert.deepEqual(harness.renameCalls, []);
  assert.deepEqual(harness.queuedMoves, []);
});

test('non-Markdown unarchive can recover its source folder from the preserved archive path', () => {
  assert.equal(
    getArchiveRelativeOriginalFolder('_archive/Projects/Roadmap.base', '_archive'),
    'Projects',
  );
  assert.equal(
    getArchiveRelativeOriginalFolder('_archive/Root.canvas', '_archive'),
    '',
  );
  assert.equal(
    getArchiveRelativeOriginalFolder('Projects/Roadmap.base', '_archive'),
    '',
  );
});

test('unarchive moves first, then removes Markdown archive metadata', async () => {
  const harness = createArchiveHarness({
    files: [
      { path: '_archive/Inbox/Restore.md', frontmatter: {
        tags: ['archive', 'keep'],
        archiveOriginalFolder: 'Inbox',
      } },
      '_archive/Projects/Roadmap.base',
    ],
  });
  const markdown = harness.getFile('_archive/Inbox/Restore.md');
  const base = harness.getFile('_archive/Projects/Roadmap.base');
  const service = new ArchiveFileService(harness.plugin);

  const result = await service.unarchiveFiles([markdown, base], 'native-context-menu');

  assert.equal(result.moved, 2);
  assert.equal(result.failed, 0);
  assert.ok(harness.getFile('Inbox/Restore.md'));
  assert.ok(harness.getFile('Projects/Roadmap.base'));
  assert.deepEqual(harness.processFrontMatterCalls, ['Inbox/Restore.md']);
  assert.deepEqual(harness.getFrontmatter(markdown), { tags: ['keep'] });
});

test('a failed unarchive move preserves the Markdown restore metadata for a safe retry', async () => {
  const archivedPath = '_archive/Inbox/Retry.md';
  const harness = createArchiveHarness({
    files: [{ path: archivedPath, frontmatter: {
      tags: ['archive', 'keep'],
      archiveOriginalFolder: 'Inbox',
    } }],
    failRenameFrom: [archivedPath],
  });
  const file = harness.getFile(archivedPath);
  const service = new ArchiveFileService(harness.plugin);

  const originalConsoleError = console.error;
  const capturedErrors = [];
  console.error = (...args) => capturedErrors.push(args);
  let result;
  try {
    result = await service.unarchiveFiles([file], 'native-context-menu');
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(result.moved, 0);
  assert.equal(result.failed, 1);
  assert.equal(capturedErrors.length, 1);
  assert.equal(file.path, archivedPath);
  assert.deepEqual(harness.processFrontMatterCalls, []);
  assert.deepEqual(harness.getFrontmatter(file), {
    tags: ['archive', 'keep'],
    archiveOriginalFolder: 'Inbox',
  });
});

test('a thrown metadata cleanup failure rolls the moved note back into archive with metadata intact', async () => {
  const archivedPath = '_archive/Inbox/Cleanup throw.md';
  const restoredPath = 'Inbox/Cleanup throw.md';
  const harness = createArchiveHarness({
    files: [{ path: archivedPath, frontmatter: {
      tags: ['archive', 'keep'],
      archiveOriginalFolder: 'Inbox',
    } }],
    failMetadataFor: [restoredPath],
  });
  const file = harness.getFile(archivedPath);
  const service = new ArchiveFileService(harness.plugin);

  const result = await service.unarchiveFiles([file], 'native-context-menu');

  assert.equal(result.moved, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.metadataFailures, 1);
  assert.equal(file.path, archivedPath);
  assert.ok(harness.getFile(archivedPath));
  assert.equal(harness.getFile(restoredPath), null);
  assert.deepEqual(harness.renameCalls, [
    { from: archivedPath, to: restoredPath },
    { from: restoredPath, to: archivedPath },
  ]);
  assert.deepEqual(harness.processFrontMatterCalls, [restoredPath]);
  assert.deepEqual(harness.getFrontmatter(file), {
    tags: ['archive', 'keep'],
    archiveOriginalFolder: 'Inbox',
  });
});

test('a resolved-false metadata cleanup rolls the moved note back into archive with metadata intact', async () => {
  const archivedPath = '_archive/Inbox/Cleanup refused.md';
  const restoredPath = 'Inbox/Cleanup refused.md';
  const harness = createArchiveHarness({
    files: [{ path: archivedPath, frontmatter: {
      tags: ['archive', 'keep'],
      archiveOriginalFolder: 'Inbox',
    } }],
    returnFalseMetadataFor: [restoredPath],
  });
  const file = harness.getFile(archivedPath);
  const service = new ArchiveFileService(harness.plugin);

  const result = await service.unarchiveFiles([file], 'native-context-menu');

  assert.equal(result.moved, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.metadataFailures, 1);
  assert.equal(file.path, archivedPath);
  assert.ok(harness.getFile(archivedPath));
  assert.equal(harness.getFile(restoredPath), null);
  assert.deepEqual(harness.renameCalls, [
    { from: archivedPath, to: restoredPath },
    { from: restoredPath, to: archivedPath },
  ]);
  assert.deepEqual(harness.processFrontMatterCalls, [restoredPath]);
  assert.deepEqual(harness.getFrontmatter(file), {
    tags: ['archive', 'keep'],
    archiveOriginalFolder: 'Inbox',
  });
});
