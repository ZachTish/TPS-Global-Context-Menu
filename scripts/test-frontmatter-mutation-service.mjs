import assert from 'node:assert/strict';
import test from 'node:test';
import { TFile } from 'obsidian';
import { FrontmatterMutationService } from '../src/services/frontmatter-mutation-service.ts';

function createHarness(initialContent, options = {}) {
  const file = new TFile('Notes/Mutation Harness.md');
  let content = initialContent;
  let modifyCount = 0;
  let processAttemptCount = 0;
  let processTail = Promise.resolve();
  const plugin = {
    settings: {
      properties: [],
      enableActivityLog: false,
      enableAutoRename: options.enableAutoRename === true,
    },
    app: {
      vault: {
        read: async () => content,
        cachedRead: async () => content,
        modify: async (_file, nextContent) => {
          content = nextContent;
          modifyCount += 1;
        },
        process: async (_file, transform) => {
          const operation = processTail.then(() => {
            processAttemptCount += 1;
            try {
              const nextContent = transform(content);
              content = nextContent;
              modifyCount += 1;
              return content;
            } catch (error) {
              options.afterProcessError?.({
                attempt: processAttemptCount,
                error,
                setContent(nextContent) {
                  content = nextContent;
                },
              });
              throw error;
            }
          });
          processTail = operation.catch(() => undefined);
          return operation;
        },
        getFileByPath: (path) => path === file.path ? file : null,
      },
      workspace: {
        activeLeaf: null,
        getLeavesOfType: () => [],
      },
    },
    canvasPropertiesService: {
      isCanvasFile: () => false,
    },
    eventService: {
      emitExplicitAction() {
        if (options.throwAfterCommit) throw new Error('synthetic event listener failure');
      },
    },
    fileNamingService: {
      async updateFilenameIfNeeded() {
        if (options.renameError) throw options.renameError;
      },
    },
  };

  return {
    file,
    service: new FrontmatterMutationService(plugin),
    createService: () => new FrontmatterMutationService(plugin),
    getContent: () => content,
    getModifyCount: () => modifyCount,
    getProcessAttemptCount: () => processAttemptCount,
  };
}

for (const [label, opening, separator] of [
  ['space-padded delimiters and lone carriage returns', '---   ', '\r'],
  ['tab-padded delimiters and CRLF', '---\t', '\r\n'],
]) {
  test(`mutation recognizes ${label} without creating duplicate frontmatter`, async () => {
    const original = [opening, 'title: Original', 'tags: KeepMe', opening, 'Body', ''].join(separator);
    const harness = createHarness(original);

    const changed = await harness.service.processGuarded(harness.file, (frontmatter) => {
      frontmatter.status = 'done';
      return true;
    });

    const content = harness.getContent();
    assert.equal(changed, true);
    assert.equal(harness.getModifyCount(), 1);
    assert.equal(content.split('\n').filter((line) => line === '---').length, 2);
    assert.match(content, /status: "done"/);
    assert.match(content, /tags:\n  - "keepme"/);
    assert.ok(content.endsWith('Body\n'));
  });
}

test('a guarded abort is byte-identical and skips global normalizers', async () => {
  const original = '---\r\ntags: KeepMe\r\ntitle: Original\r\n---\r\nBody\r\n';
  const harness = createHarness(original);

  const changed = await harness.service.processGuarded(harness.file, () => false);

  assert.equal(changed, false);
  assert.equal(harness.getModifyCount(), 0);
  assert.equal(harness.getContent(), original);
});

test('typed mutation outcomes distinguish changed, unchanged, guarded, malformed, and unsupported paths', async () => {
  const original = '---\ntitle: Original\n---\nBody\n';
  const harness = createHarness(original);

  assert.equal(await harness.service.processWithOutcome(harness.file, (frontmatter) => {
    frontmatter.status = 'done';
  }), 'changed');
  assert.equal(await harness.service.processWithOutcome(harness.file, (frontmatter) => {
    frontmatter.status = 'done';
  }), 'unchanged');
  const beforeExplicitNoop = harness.getContent();
  assert.equal(await harness.service.processGuardedWithOutcome(harness.file, () => 'unchanged'), 'unchanged');
  assert.equal(harness.getContent(), beforeExplicitNoop);
  assert.equal(await harness.service.processGuardedWithOutcome(harness.file, () => false), 'guarded-abort');

  const malformed = createHarness('---\n{broken\n---\nBody\n');
  assert.equal(
    await malformed.service.processWithOutcome(malformed.file, (frontmatter) => {
      frontmatter.status = 'must-not-write';
    }),
    'parse-failed',
  );
  assert.equal(malformed.getContent(), '---\n{broken\n---\nBody\n');

  const unsupportedFile = new TFile('Notes/Unsupported.txt');
  assert.equal(
    await harness.service.processWithOutcome(unsupportedFile, () => {}),
    'unsupported',
  );
});

test('an immediately empty frontmatter block is a valid atomic mutation target', async () => {
  const harness = createHarness('---\n---\nBody\n');

  const changed = await harness.service.processGuarded(harness.file, (frontmatter) => {
    frontmatter.status = 'created';
    return true;
  });

  assert.equal(changed, true);
  assert.equal(harness.getModifyCount(), 1);
  assert.equal(harness.getContent().split('\n').filter((line) => line === '---').length, 2);
  assert.match(harness.getContent(), /status: "created"/);
  assert.ok(harness.getContent().endsWith('Body\n'));
});

test('a follow-up event failure cannot turn a durable write into a rejected mutation', async () => {
  const harness = createHarness('---\ntitle: Original\n---\nBody\n', { throwAfterCommit: true });

  const changed = await harness.service.processGuarded(harness.file, (frontmatter) => {
    frontmatter.status = 'committed';
    return true;
  });

  assert.equal(changed, true);
  assert.equal(harness.getModifyCount(), 1);
  assert.match(harness.getContent(), /status: "committed"/);
});

test('a post-commit auto-rename failure cannot turn a durable frontmatter write into failure', async () => {
  const harness = createHarness('---\ntitle: Original\n---\nBody\n', {
    enableAutoRename: true,
    renameError: new Error('synthetic rename failure'),
  });

  const outcome = await harness.service.processWithOutcome(harness.file, (frontmatter) => {
    frontmatter.title = 'Renamed';
  });

  assert.equal(outcome, 'changed');
  assert.equal(harness.getModifyCount(), 1);
  assert.match(harness.getContent(), /title: "Renamed"/);
});

test('same-service atomic writes to one note preserve both mutations', async () => {
  const harness = createHarness('---\ntitle: Original\n---\nBody\n');
  const first = harness.service.processGuarded(harness.file, (frontmatter) => {
    frontmatter.alpha = 'one';
    return true;
  });
  const second = harness.service.processGuarded(harness.file, (frontmatter) => {
    frontmatter.beta = 'two';
    return true;
  });

  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(harness.getModifyCount(), 2);
  assert.match(harness.getContent(), /alpha: "one"/);
  assert.match(harness.getContent(), /beta: "two"/);
});

test('different mutation-service instances preserve concurrent writes through Vault.process', async () => {
  const harness = createHarness('---\ntitle: Original\n---\nBody\n');
  const secondService = harness.createService();

  const first = harness.service.processGuarded(harness.file, (frontmatter) => {
    frontmatter.alpha = 'one';
    return true;
  });
  const second = secondService.processGuarded(harness.file, (frontmatter) => {
    frontmatter.beta = 'two';
    return true;
  });

  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(harness.getModifyCount(), 2);
  assert.match(harness.getContent(), /alpha: "one"/);
  assert.match(harness.getContent(), /beta: "two"/);
});

test('promise-returning Markdown mutators fail closed without persisting synchronous partial changes', async () => {
  const original = '---\ntitle: Original\n---\nBody\n';
  const harness = createHarness(original);

  await assert.rejects(
    harness.service.process(harness.file, (frontmatter) => {
      frontmatter.status = 'must-not-write';
      return Promise.resolve();
    }),
    /must be synchronous/i,
  );

  assert.equal(harness.getModifyCount(), 0);
  assert.equal(harness.getContent(), original);
});

test('a malformed snapshot fails closed immediately without retrying or running the mutator', async () => {
  const original = '---\n{broken\n---\nBody\n';
  const harness = createHarness(original);
  let mutatorCalls = 0;

  const outcome = await harness.service.processGuardedWithOutcome(harness.file, (frontmatter) => {
    mutatorCalls += 1;
    frontmatter.status = 'done';
    return true;
  });

  assert.equal(outcome, 'parse-failed');
  assert.equal(mutatorCalls, 0);
  assert.equal(harness.getProcessAttemptCount(), 1);
  assert.equal(harness.getModifyCount(), 0);
  assert.equal(harness.getContent(), original);
});

test('duplicate top-level YAML keys are never silently repaired or discarded', async () => {
  const original = '---\ntitle: First\ntitle: Second\ntags: keep\n---\nBody\n';
  const harness = createHarness(original);
  let mutatorCalls = 0;

  const outcome = await harness.service.processGuardedWithOutcome(harness.file, (frontmatter) => {
    mutatorCalls += 1;
    frontmatter.status = 'done';
    return true;
  });

  assert.equal(outcome, 'parse-failed');
  assert.equal(mutatorCalls, 0);
  assert.equal(harness.getProcessAttemptCount(), 1);
  assert.equal(harness.getModifyCount(), 0);
  assert.equal(harness.getContent(), original);
});

test('concurrent exact-style same-ID insertions commit one authoritative record', async () => {
  const harness = createHarness('---\ntpsId: workout-one\ntimeTracking: []\n---\nBody\n');
  const secondService = harness.createService();
  const record = {
    id: 'gcm-session-one',
    targetId: 'workout-one',
    targetType: 'note',
    sourcePath: 'Notes/Mutation Harness.md',
    start: '2026-07-20T05:00:00.000Z',
  };
  const insert = (frontmatter) => {
    const allEntries = Object.values(frontmatter).flatMap((value) => Array.isArray(value) ? value : [value]);
    if (allEntries.some((value) => value && typeof value === 'object' && value.id === record.id)) return false;
    frontmatter.timeTracking = [...(frontmatter.timeTracking || []), record];
    return true;
  };

  const results = await Promise.all([
    harness.service.processGuarded(harness.file, insert),
    secondService.processGuarded(harness.file, insert),
  ]);

  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(harness.getModifyCount(), 1);
  assert.equal((harness.getContent().match(/gcm-session-one/g) || []).length, 1);
});

test('an exact-style stop concurrent with another session insertion preserves both changes', async () => {
  const existing = JSON.stringify({
    id: 'gcm-existing',
    targetId: 'workout-one',
    targetType: 'note',
    sourcePath: 'Notes/Mutation Harness.md',
    start: '2026-07-20T05:00:00.000Z',
  });
  const harness = createHarness(`---\ntimeTracking:\n  - ${existing}\n---\nBody\n`);
  const secondService = harness.createService();

  const stop = harness.service.processGuarded(harness.file, (frontmatter) => {
    const sessions = frontmatter.timeTracking;
    const index = sessions.findIndex((session) => session.id === 'gcm-existing' && !session.end);
    if (index < 0) return false;
    sessions[index] = { ...sessions[index], end: '2026-07-20T05:45:00.000Z' };
    return true;
  });
  const insert = secondService.processGuarded(harness.file, (frontmatter) => {
    frontmatter.timeTracking = [...frontmatter.timeTracking, {
      id: 'gcm-new',
      targetId: 'workout-two',
      targetType: 'note',
      sourcePath: 'Notes/Other.md',
      start: '2026-07-20T05:15:00.000Z',
    }];
    return true;
  });

  assert.deepEqual(await Promise.all([stop, insert]), [true, true]);
  assert.equal(harness.getModifyCount(), 2);
  assert.match(harness.getContent(), /gcm-existing/);
  assert.match(harness.getContent(), /2026-07-20T05:45:00\.000Z/);
  assert.match(harness.getContent(), /gcm-new/);
});
