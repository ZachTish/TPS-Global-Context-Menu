import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

async function importBundled(relativePath, plugins = []) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
    plugins,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const obsidianStubPlugin = {
  name: 'obsidian-stub',
  setup(context) {
    context.onResolve({ filter: /^obsidian$/u }, () => ({
      path: 'obsidian',
      namespace: 'test',
    }));
    context.onLoad({ filter: /.*/u, namespace: 'test' }, () => ({
      contents: [
        'export class App {}',
        'export class TFile {}',
        'export class Modal {}',
        'export class Notice {}',
        'export class Setting {}',
        'export const normalizePath = (value) => String(value);',
      ].join('\n'),
      loader: 'js',
    }));
  },
};

const creationPromise = importBundled('../src/views/base-line-creation-plan.ts');
const filterPromise = importBundled('../src/views/log-base-filter.ts');
const taskEditorPromise = importBundled('../src/services/task-editor-properties.ts');
const tpsListStatusRoutingPromise = importBundled(
  '../src/tps-list/relational-status-routing.ts',
);
const sharedStatusPromise = importBundled(
  '../src/services/shared/status-service.ts',
  [obsidianStubPlugin],
);
const linkedSubitemMutationPromise = importBundled(
  '../src/services/linked-subitem-checkbox-mutation.ts',
);
const linkedSubitemMappingPromise = importBundled(
  '../src/utils/linked-subitem-mapping.ts',
);
const subitemLineModelPromise = importBundled(
  '../src/services/subitem-line-model.ts',
  [obsidianStubPlugin],
);

const isCheckboxWorkflowStatus = (property) => {
  const normalized = String(property || '').trim().toLowerCase().replace(/\s+/gu, '');
  return normalized === 'task.status' || normalized === 'checkboxstatus';
};

function relationalStatusProperty() {
  return {
    id: 'status',
    key: 'status',
    label: 'Status',
    type: 'selector',
    acceptsKind: 'status',
    optionSources: ['entity'],
  };
}

function filterContext(fields) {
  return {
    fields,
    rowKind: 'task',
    file: {
      path: 'Inbox/Tasks.md',
      name: 'Tasks.md',
      basename: 'Tasks',
      extension: 'md',
      folder: 'Inbox',
      tags: [],
      frontmatter: {},
    },
  };
}

test('shared status service reads taskStatus instead of a relational status identity', async () => {
  const { SharedStatusService } = await sharedStatusPromise;
  const service = new SharedStatusService({
    settings: {
      properties: [relationalStatusProperty()],
      recurrenceCompletionStatuses: ['complete', 'wont-do'],
      activeStatusValues: ['todo', 'working', 'holding'],
    },
  });

  assert.equal(service.getStatusPropertyKey(), 'taskStatus');
  assert.equal(service.getRelationalStatusPropertyKey(), 'status');
  assert.deepEqual(service.getStatuses({
    status: '[[Entities/Statuses/Blocked]]',
    taskStatus: 'working',
  }), ['working']);
  assert.deepEqual(service.getStatuses({
    status: '[[Entities/Statuses/Blocked]]',
  }), []);
  assert.equal(service.isDoneStatus('complete'), true);
  assert.equal(service.isDoneStatus('working'), false);
});

test('shared status service resolves only authoritative checkbox mappings and aliases', async () => {
  const { SharedStatusService } = await sharedStatusPromise;
  const service = new SharedStatusService({
    settings: {
      properties: [],
      recurrenceCompletionStatuses: ['complete', 'wont-do'],
      activeStatusValues: ['todo', 'working', 'holding'],
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[d]', statuses: ['done'] },
        { checkboxState: '[!]', statuses: ['blocked'] },
      ],
    },
  });

  assert.equal(service.checkboxStateToStatus('[d]'), 'complete');
  assert.equal(service.checkboxStateToStatus('!'), 'holding');
  assert.equal(service.statusToCheckboxState('completed'), 'd');
  assert.equal(service.statusToCheckboxState('blocked'), '!');
  assert.equal(service.checkboxStateToStatus('[?]'), '');
  assert.equal(service.statusToCheckboxState('working'), '');
});

test('linked child rows derive status, completion, and icon presentation from the configured mapping', () => {
  const modelSource = readFileSync(new URL('../src/services/subitem-line-model.ts', import.meta.url), 'utf8');
  const rowSource = readFileSync(new URL('../src/services/linked-subitem-row-builder.ts', import.meta.url), 'utf8');
  const checkboxSource = readFileSync(new URL('../src/services/linked-subitem-checkbox-service.ts', import.meta.url), 'utf8');
  const bulkEditSource = readFileSync(new URL('../src/services/bulk-edit-service.ts', import.meta.url), 'utf8');

  assert.match(modelSource, /getLinkedSubitemMappingForState\(this\.getMappings\(\), checkboxState\)\?\.icon/u);
  assert.match(modelSource, /getLinkedSubitemCompleteMarkers\(this\.getMappings\(\), \{[\s\S]{0,260}getDoneStatuses/u);
  assert.match(modelSource, /sharedServices\.status\.normalize\(actualKey \? fm\[actualKey\] : ''\)/u);
  assert.match(rowSource, /return model\.checkboxIcon \|\| getIconNameForState/u);
  assert.doesNotMatch(checkboxSource, /setLinkedSubitemStatus/u);
  assert.match(checkboxSource, /handleCustomCheckboxClick[\s\S]{0,1200}setLinkedSubitemCheckboxState\(parentFile, childFile, nextState\)/u);
  assert.match(checkboxSource, /setLinkedSubitemCheckboxState\(parentFile, childFile, nextState, sourceLine\)/u);
  assert.match(checkboxSource, /item\.onClick\(async \(\) => \{[\s\S]{0,650}setLinkedSubitemCheckboxState\(/u);
  assert.match(checkboxSource, /runGuardedLinkedSubitemMutation\(\{/u);
  assert.match(checkboxSource, /previousStatus = await this\.readAuthoritativeChildStatus\(childFile\)/u);
  assert.match(checkboxSource, /readAuthoritativeChild: async \(\) => \{[\s\S]{0,220}readAuthoritativeChildStatus\(childFile\)/u);
  assert.match(checkboxSource, /readAuthoritativeParent: async \(\) => \{[\s\S]{0,220}readMarkdownText\(parentFile\)/u);
  assert.match(checkboxSource, /private async readAuthoritativeChildStatus\([\s\S]{0,220}vault\.read\(file\)/u);
  assert.match(
    checkboxSource,
    /mutateMarkdownBody\(parentFile,[\s\S]{0,260}getStatusForCheckboxState\(normalizedToken\) !== mappedStatus[\s\S]{0,120}mappingGuardBlocked = true/u,
  );
  assert.match(
    checkboxSource,
    /writeChild: async \(\) => \{[\s\S]{0,420}setStatus\(\[childFile\], mappedStatus, \{[\s\S]{0,180}writeGuard:/u,
  );
  assert.match(
    bulkEditSource,
    /runInBatches\(files, async \(file\) => \{[\s\S]{0,180}if \(options\.writeGuard\?\.\(file\) === false\) return;/u,
  );
  assert.match(
    bulkEditSource,
    /frontmatterMutationService\.process\(file, \(fm\) => \{\s*if \(options\.writeGuard\?\.\(file\) === false\) return;/u,
  );
  assert.doesNotMatch(checkboxSource, /setStatus\(\[childFile\], mappedStatus\)\) > 0/u);
  assert.doesNotMatch(checkboxSource, /fm\[statusKey\] = nextStatus/u);
});

test('linked-subitem mutation blocks stale or failed parents before touching the child', async () => {
  const { runGuardedLinkedSubitemMutation } = await linkedSubitemMutationPromise;

  for (const parentFailure of ['blocked', 'throw']) {
    const state = { parent: '[ ]', child: 'todo' };
    let childWrites = 0;
    let rollbacks = 0;
    const result = await runGuardedLinkedSubitemMutation({
      needsChildWrite: true,
      writeParent: async () => {
        if (parentFailure === 'throw') throw new Error('synthetic parent write failure');
        return 'blocked';
      },
      writeChild: async () => {
        childWrites += 1;
        state.child = 'complete';
      },
      readAuthoritativeChild: async () => state.child === 'complete' ? 'target' : 'previous',
      restoreParent: async () => {
        rollbacks += 1;
      },
      readAuthoritativeParent: async () => state.parent === '[ ]' ? 'previous' : 'updated',
    });

    assert.equal(result.ok, false, parentFailure);
    assert.equal(result.reason, parentFailure === 'throw' ? 'parent-failed' : 'parent-blocked');
    assert.deepEqual(state, { parent: '[ ]', child: 'todo' }, parentFailure);
    assert.equal(childWrites, 0, `${parentFailure}: child mutation must not run`);
    assert.equal(rollbacks, 0, `${parentFailure}: no parent write means no rollback`);
  }
});

test('linked-subitem mutation performs zero writes when the checkbox mapping changes before the parent boundary', async () => {
  const { runGuardedLinkedSubitemMutation } = await linkedSubitemMutationPromise;
  const capturedStatus = 'complete';
  let liveStatus = capturedStatus;
  let parentWrites = 0;
  let childWrites = 0;

  liveStatus = 'archived';
  const result = await runGuardedLinkedSubitemMutation({
    needsChildWrite: true,
    writeParent: async () => {
      if (liveStatus !== capturedStatus) return 'blocked';
      parentWrites += 1;
      return 'changed';
    },
    writeChild: async () => {
      childWrites += 1;
    },
    readAuthoritativeChild: async () => 'previous',
    restoreParent: async () => {},
    readAuthoritativeParent: async () => 'previous',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'parent-blocked');
  assert.equal(parentWrites, 0);
  assert.equal(childWrites, 0);
});

test('linked-subitem mutation rolls back the parent when the mapping changes at the child write boundary', async () => {
  const { runGuardedLinkedSubitemMutation } = await linkedSubitemMutationPromise;
  const state = { parent: '[ ]', child: 'todo' };
  const capturedStatus = 'complete';
  let liveStatus = capturedStatus;
  let childWrites = 0;

  const result = await runGuardedLinkedSubitemMutation({
    needsChildWrite: true,
    writeParent: async () => {
      state.parent = '[x]';
      liveStatus = 'archived';
      return 'changed';
    },
    writeChild: async () => {
      if (liveStatus !== capturedStatus) return;
      childWrites += 1;
      state.child = capturedStatus;
    },
    readAuthoritativeChild: async () => state.child === capturedStatus ? 'target' : 'previous',
    restoreParent: async () => {
      state.parent = '[ ]';
    },
    readAuthoritativeParent: async () => state.parent === '[ ]' ? 'previous' : 'updated',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'child-blocked');
  assert.equal(result.parentRolledBack, true);
  assert.equal(childWrites, 0);
  assert.deepEqual(state, { parent: '[ ]', child: 'todo' });
});

test('linked-subitem mutation restores the parent when the child status write is blocked', async () => {
  const { runGuardedLinkedSubitemMutation } = await linkedSubitemMutationPromise;
  const state = { parent: '[ ]', child: 'todo' };
  const timeline = [];

  const result = await runGuardedLinkedSubitemMutation({
    needsChildWrite: true,
    writeParent: async () => {
      timeline.push('parent-write');
      state.parent = '[x]';
      return 'changed';
    },
    writeChild: async () => {
      timeline.push('child-blocked');
    },
    readAuthoritativeChild: async () => state.child === 'todo' ? 'previous' : 'target',
    restoreParent: async () => {
      timeline.push('parent-rollback');
      state.parent = '[ ]';
    },
    readAuthoritativeParent: async () => state.parent === '[ ]' ? 'previous' : 'updated',
  });

  assert.deepEqual(result, {
    ok: false,
    changed: false,
    parentChanged: true,
    childChanged: false,
    parentRolledBack: true,
    reason: 'child-blocked',
  });
  assert.deepEqual(timeline, ['parent-write', 'child-blocked', 'parent-rollback']);
  assert.deepEqual(state, { parent: '[ ]', child: 'todo' });

  let unnecessaryRollback = 0;
  const alreadyAlignedParent = await runGuardedLinkedSubitemMutation({
    needsChildWrite: true,
    writeParent: async () => 'unchanged',
    writeChild: async () => {},
    readAuthoritativeChild: async () => 'previous',
    restoreParent: async () => {
      unnecessaryRollback += 1;
    },
    readAuthoritativeParent: async () => 'updated',
  });
  assert.equal(alreadyAlignedParent.reason, 'child-blocked');
  assert.equal(alreadyAlignedParent.parentChanged, false);
  assert.equal(alreadyAlignedParent.parentRolledBack, true);
  assert.equal(unnecessaryRollback, 0);

  state.parent = '[ ]';
  const thrownChild = await runGuardedLinkedSubitemMutation({
    needsChildWrite: true,
    writeParent: async () => {
      state.parent = '[x]';
      return 'changed';
    },
    writeChild: async () => {
      throw new Error('synthetic child failure');
    },
    readAuthoritativeChild: async () => 'previous',
    restoreParent: async () => {
      state.parent = '[ ]';
    },
    readAuthoritativeParent: async () => state.parent === '[ ]' ? 'previous' : 'updated',
  });
  assert.equal(thrownChild.reason, 'child-failed');
  assert.match(String(thrownChild.error), /synthetic child failure/u);
  assert.deepEqual(state, { parent: '[ ]', child: 'todo' });
});

test('linked-subitem mutation commits the parent marker and child status in guarded order', async () => {
  const { runGuardedLinkedSubitemMutation } = await linkedSubitemMutationPromise;
  const state = { parent: '[ ]', child: 'todo' };
  const timeline = [];

  const result = await runGuardedLinkedSubitemMutation({
    needsChildWrite: true,
    writeParent: async () => {
      timeline.push('parent-write');
      state.parent = '[x]';
      return 'changed';
    },
    writeChild: async () => {
      timeline.push('child-write');
      state.child = 'complete';
    },
    readAuthoritativeChild: async () => state.child === 'complete' ? 'target' : 'previous',
    restoreParent: async () => {
      timeline.push('unexpected-rollback');
    },
    readAuthoritativeParent: async () => state.parent === '[ ]' ? 'previous' : 'updated',
  });

  assert.deepEqual(result, {
    ok: true,
    changed: true,
    parentChanged: true,
    childChanged: true,
    parentRolledBack: false,
    reason: 'done',
  });
  assert.deepEqual(timeline, ['parent-write', 'child-write']);
  assert.deepEqual(state, { parent: '[x]', child: 'complete' });
});

test('linked-subitem mutation trusts the authoritative child reread over ambiguous write outcomes', async () => {
  const { runGuardedLinkedSubitemMutation } = await linkedSubitemMutationPromise;

  for (const writeOutcome of ['zero-or-idempotent', 'post-write-error']) {
    const state = { parent: '[ ]', child: 'todo' };
    let rollbacks = 0;
    const result = await runGuardedLinkedSubitemMutation({
      needsChildWrite: true,
      writeParent: async () => {
        state.parent = '[x]';
        return 'changed';
      },
      writeChild: async () => {
        state.child = 'complete';
        if (writeOutcome === 'post-write-error') {
          throw new Error('synthetic error after the child write committed');
        }
      },
      readAuthoritativeChild: async () => state.child === 'complete' ? 'target' : 'previous',
      restoreParent: async () => {
        rollbacks += 1;
        state.parent = '[ ]';
      },
      readAuthoritativeParent: async () => state.parent === '[ ]' ? 'previous' : 'updated',
    });

    assert.deepEqual(result, {
      ok: true,
      changed: true,
      parentChanged: true,
      childChanged: true,
      parentRolledBack: false,
      reason: 'done',
    }, writeOutcome);
    assert.deepEqual(state, { parent: '[x]', child: 'complete' }, writeOutcome);
    assert.equal(rollbacks, 0, `${writeOutcome}: a verified target child must never roll back its parent`);
  }
});

test('linked-subitem mutation does not guess at compensation when the child cannot be reread', async () => {
  const { runGuardedLinkedSubitemMutation } = await linkedSubitemMutationPromise;
  const state = { parent: '[ ]', child: 'todo' };
  let rollbacks = 0;

  const result = await runGuardedLinkedSubitemMutation({
    needsChildWrite: true,
    writeParent: async () => {
      state.parent = '[x]';
      return 'changed';
    },
    writeChild: async () => {
      state.child = 'complete';
      throw new Error('synthetic post-write failure');
    },
    readAuthoritativeChild: async () => {
      throw new Error('synthetic authoritative read failure');
    },
    restoreParent: async () => {
      rollbacks += 1;
      state.parent = '[ ]';
    },
    readAuthoritativeParent: async () => state.parent === '[ ]' ? 'previous' : 'updated',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'child-verification-failed');
  assert.equal(result.parentRolledBack, false);
  assert.equal(rollbacks, 0, 'an unverified child must not trigger a potentially incorrect parent rollback');
  assert.deepEqual(state, { parent: '[x]', child: 'complete' });
});

test('linked-subitem mutation verifies parent compensation after a rollback error', async () => {
  const { runGuardedLinkedSubitemMutation } = await linkedSubitemMutationPromise;
  const state = { parent: '[ ]', child: 'todo' };

  const result = await runGuardedLinkedSubitemMutation({
    needsChildWrite: true,
    writeParent: async () => {
      state.parent = '[x]';
      return 'changed';
    },
    writeChild: async () => {},
    readAuthoritativeChild: async () => 'previous',
    restoreParent: async () => {
      state.parent = '[ ]';
      throw new Error('synthetic error after rollback committed');
    },
    readAuthoritativeParent: async () => state.parent === '[ ]' ? 'previous' : 'updated',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'child-blocked');
  assert.equal(result.parentRolledBack, true);
  assert.deepEqual(state, { parent: '[ ]', child: 'todo' });
});

test('linked-subitem source resolution rejects stale, missing, and ambiguous parent rows', async () => {
  const { resolveLinkedSubitemMutationLineIndex } = await linkedSubitemMutationPromise;
  const lines = [
    '- [ ] [[Children/First]]',
    '- [ ] [[Children/Other]]',
  ];
  const isFirst = (line) => line.includes('[[Children/First]]');

  assert.equal(resolveLinkedSubitemMutationLineIndex(lines, 'Parent.md', {
    parentPath: 'Parent.md',
    lineNumber: 0,
    rawLine: lines[0],
  }, isFirst), 0);
  assert.equal(resolveLinkedSubitemMutationLineIndex(lines, 'Parent.md', {
    parentPath: 'Parent.md',
    lineNumber: 0,
    rawLine: '- [x] [[Children/First]]',
  }, isFirst), -1, 'a stale captured row must not fall back to a broad scan');
  assert.equal(resolveLinkedSubitemMutationLineIndex(lines, 'Parent.md', {
    parentPath: 'Parent.md',
    lineNumber: 9,
    rawLine: '- [ ] [[Children/First]]',
  }, isFirst), -1);
  assert.equal(resolveLinkedSubitemMutationLineIndex(lines, 'Other Parent.md', {
    parentPath: 'Parent.md',
    lineNumber: 0,
    rawLine: lines[0],
  }, isFirst), -1);
  assert.equal(resolveLinkedSubitemMutationLineIndex(lines, 'Parent.md', undefined, isFirst), 0);
  assert.equal(resolveLinkedSubitemMutationLineIndex([...lines, lines[0]], 'Parent.md', undefined, isFirst), -1);

  const checkboxSource = readFileSync(new URL('../src/services/linked-subitem-checkbox-service.ts', import.meta.url), 'utf8');
  const resolver = methodSource(
    checkboxSource,
    'private resolveLinkedSubitemLineIndex(',
    'private isLinkedSubitemLineForChild(',
  );

  assert.match(resolver, /return resolveLinkedSubitemMutationLineIndex\(/u);
});

test('linked child visual completion canonicalizes an authored uppercase X marker', async () => {
  const { SubitemLineModelService } = await subitemLineModelPromise;
  const normalize = (value) => String(value ?? '').trim().toLowerCase();
  const service = new SubitemLineModelService({
    settings: {
      linkedSubitemCheckboxMappings: [
        { checkboxState: '[ ]', statuses: ['todo'] },
        { checkboxState: '[X]', statuses: ['complete'] },
        { checkboxState: '[-]', statuses: ['wont-do'] },
      ],
    },
    sharedServices: {
      status: {
        normalize,
        getDoneStatuses: () => ['complete', 'wont-do'],
      },
    },
  });

  assert.equal(service.getVisualState('[X]'), 'complete');
  assert.equal(service.getVisualState('X'), 'complete');
  assert.equal(service.getVisualState('[ ]'), 'open');
});

test('the reserved blank checkbox remains intrinsically open even in malformed persisted mappings', async () => {
  const { getLinkedSubitemCompleteMarkers } = await linkedSubitemMappingPromise;
  assert.deepEqual(
    getLinkedSubitemCompleteMarkers([
      { checkboxState: '[ ]', statuses: ['complete'] },
      { checkboxState: '[x]', statuses: ['complete'] },
    ], { completionStatuses: ['complete'] }),
    ['x'],
  );
});

function methodSource(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Expected source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test('bare relational status and task.status compose into separate creation defaults', async () => {
  const { resolveTpsBaseLineCreationPlan } = await creationPromise;
  const plan = resolveTpsBaseLineCreationPlan([
    'kind == "task"',
    'status == "[[Entities/Statuses/Blocked]]"',
    'task.status == "working"',
  ], {
    isWorkflowStatusProperty: isCheckboxWorkflowStatus,
  });

  assert.equal(plan.blockedReason, null);
  assert.equal(plan.kind, 'task');
  assert.equal(plan.status, 'working');
  assert.deepEqual(plan.fields, {
    status: '[[Entities/Statuses/Blocked]]',
  });
  assert.equal(plan.provenance.status?.expression, 'task.status == "working"');
  assert.equal(plan.provenance.fields.status?.expression, 'status == "[[Entities/Statuses/Blocked]]"');
});

test('checkboxStatus remains a virtual workflow-status default with relational status enabled', async () => {
  const { resolveTpsBaseLineCreationPlan } = await creationPromise;
  const plan = resolveTpsBaseLineCreationPlan([
    'kind == "task"',
    'checkboxStatus == "complete"',
  ], {
    isWorkflowStatusProperty: isCheckboxWorkflowStatus,
  });

  assert.equal(plan.blockedReason, null);
  assert.equal(plan.status, 'complete');
  assert.deepEqual(plan.fields, {});
});

test('legacy nonentity bare status keeps its checkbox-workflow behavior', async () => {
  const { resolveTpsBaseLineCreationPlan } = await creationPromise;
  const plan = resolveTpsBaseLineCreationPlan([
    'kind == "task"',
    'status == "holding"',
  ]);

  assert.equal(plan.blockedReason, null);
  assert.equal(plan.status, 'holding');
  assert.deepEqual(plan.fields, {});
});

test('filters compare relational status independently from task.status and checkboxStatus', async () => {
  const { evaluateLogBaseFilterRoots } = await filterPromise;
  const context = filterContext({
    kind: 'task',
    status: '[[Entities/Statuses/Blocked]]',
    'task.status': 'working',
    checkboxstatus: 'working',
  });

  assert.equal(evaluateLogBaseFilterRoots([
    'status == "[[Entities/Statuses/Blocked]]"',
    'task.status == "working"',
    'checkboxStatus == "working"',
  ], context), true);
  assert.equal(evaluateLogBaseFilterRoots(['status == "working"'], context), false);
  assert.equal(evaluateLogBaseFilterRoots(['task.status == "[[Entities/Statuses/Blocked]]"'], context), false);
});

test('TPS List routes bare status expressions to the relation and keeps task.status virtual', async () => {
  const {
    isRelationalStatusFilterExpression,
    isRelationalStatusPropertyReference,
    readTpsFilterExpressionProperty,
  } = await tpsListStatusRoutingPromise;
  const properties = [relationalStatusProperty()];

  assert.equal(
    isRelationalStatusPropertyReference('status', properties),
    true,
  );
  assert.equal(
    isRelationalStatusPropertyReference('property.status', properties),
    true,
  );
  assert.equal(
    isRelationalStatusPropertyReference('task.status', properties),
    false,
  );
  assert.equal(
    isRelationalStatusPropertyReference('checkboxStatus', properties),
    false,
  );

  assert.equal(
    isRelationalStatusFilterExpression(
      'status == "[[Entities/Statuses/Blocked]]"',
      properties,
    ),
    true,
  );
  assert.equal(
    isRelationalStatusFilterExpression(
      'status.contains("[[Entities/Statuses/Blocked]]")',
      properties,
    ),
    true,
  );
  assert.equal(
    isRelationalStatusFilterExpression('task.status == "working"', properties),
    false,
  );
  assert.equal(
    isRelationalStatusFilterExpression('checkboxStatus == "working"', properties),
    false,
  );
  assert.equal(
    isRelationalStatusFilterExpression(
      'status == "working"',
      [{
        ...relationalStatusProperty(),
        acceptsKind: '',
        optionSources: ['manual'],
      }],
    ),
    false,
  );

  assert.equal(
    readTpsFilterExpressionProperty('! status.isNotEmpty()'),
    'status',
  );
  assert.equal(
    readTpsFilterExpressionProperty('task.status equals working'),
    'task.status',
  );
});

test('parent completion checks read the supplied workflow status instead of relational status', async () => {
  const { ParentLinkHandler } = await importBundled(
    '../src/handlers/parent-link-handler.ts',
    [obsidianStubPlugin],
  );
  const parent = { path: 'Projects/Parent.md', basename: 'Parent' };
  const child = { path: 'Projects/Child.md', basename: 'Child' };
  const childFrontmatter = {
    childOf: 'Projects/Parent.md',
    status: '[[Entities/Statuses/Blocked]]',
    taskStatus: 'complete',
  };
  const app = {
    vault: {
      getMarkdownFiles: () => [parent, child],
      getAbstractFileByPath: () => null,
    },
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: file.path === child.path ? childFrontmatter : {},
      }),
      getFirstLinkpathDest: () => null,
    },
  };
  const getSettings = () => ({
    parentLinkFrontmatterKey: 'childOf',
    parentCompletionStatuses: ['complete', 'wont-do'],
  });

  const workflowAware = new ParentLinkHandler(
    app,
    getSettings,
    (frontmatter) => frontmatter.taskStatus,
  );
  assert.deepEqual(await workflowAware.findParentLinkIssues(parent), []);

  const hardcodedRelation = new ParentLinkHandler(
    app,
    getSettings,
    (frontmatter) => frontmatter.status,
  );
  assert.deepEqual(await hardcodedRelation.findParentLinkIssues(parent), [{
    path: child.path,
    status: '[[entities/statuses/blocked]]',
  }]);
});

test('task editor exposes an entity-source status relation but still hides legacy workflow status', async () => {
  const { collectTaskEditorProperties } = await taskEditorPromise;
  const line = '- [/] Relational status [status:: [[Entities/Statuses/Blocked]]] [priority:: high]';

  const relational = collectTaskEditorProperties(
    line,
    [relationalStatusProperty()],
    'status',
  );
  assert.deepEqual(
    relational.map(({ key, type, value }) => ({ key, type, value })),
    [
      {
        key: 'status',
        type: 'selector',
        value: '[[Entities/Statuses/Blocked]]',
      },
      {
        key: 'priority',
        type: 'text',
        value: 'high',
      },
    ],
  );

  const legacy = collectTaskEditorProperties(line, [{
    ...relationalStatusProperty(),
    acceptsKind: '',
    optionSources: ['manual'],
    options: ['todo', 'working', 'complete'],
  }], 'status');
  assert.deepEqual(
    legacy.map(({ key, type, value }) => ({ key, type, value })),
    [{ key: 'priority', type: 'text', value: 'high' }],
  );
});

test('checkbox mutation integration preserves a configured relational status field', () => {
  const taskMenuSource = readFileSync(
    new URL('../src/services/task-line-context-menu-service.ts', import.meta.url),
    'utf8',
  );
  const taskApiSource = readFileSync(
    new URL('../src/services/task-api-service.ts', import.meta.url),
    'utf8',
  );
  const sharedStatusSource = readFileSync(
    new URL('../src/services/shared/status-service.ts', import.meta.url),
    'utf8',
  );
  const workflowMutationSource = readFileSync(
    new URL('../src/utils/task-checkbox-workflow-mutation.ts', import.meta.url),
    'utf8',
  );
  const tableSource = readFileSync(
    new URL('../src/views/log-base-view.ts', import.meta.url),
    'utf8',
  );

  const checkboxMutation = methodSource(
    taskMenuSource,
    'private setTaskStatusCheckboxState(',
    'private showTaskEditorStatusMenu(',
  );
  assert.match(checkboxMutation, /setTaskCheckboxWorkflowState\(/u);
  assert.match(checkboxMutation, /this\.getTaskWorkflowFieldOwnership\(\)/u);
  assert.match(workflowMutationSource, /normalized === relationalStatusKey/u);
  assert.match(workflowMutationSource, /setInlineFieldValueOnTaskLine\(next, key, null\)/u);

  const apiMutation = methodSource(
    taskApiSource,
    'private applyTaskInputToLine(',
    "if ('replaceTags' in input",
  );
  assert.match(
    apiMutation,
    /const workflowFieldOwnership = this\.getTaskWorkflowFieldOwnership\(\)[\s\S]*?setTaskCheckboxWorkflowState\(next/u,
  );
  assert.match(
    apiMutation,
    /isTaskCheckboxOwnedWorkflowFieldKey\(key, workflowFieldOwnership\)/u,
  );

  assert.match(
    sharedStatusSource,
    /findRelationalStatusProperty\(this\.plugin\.settings\.properties\)[\s\S]{0,100}return 'taskStatus';/u,
  );
  assert.match(
    tableSource,
    /queryFields\['task\.status'\] = taskQueryFields\.status;/u,
  );
  assert.match(
    tableSource,
    /const relationalKey = normalizePropertyKeyIdentity\(relationalStatus\.key\);[\s\S]{0,180}queryFields\[relationalKey\] = fields\[relationalKey\];/u,
  );
});

test('TPS Table and TPS List open entity-backed status before workflow status', () => {
  const tableSource = readFileSync(
    new URL('../src/views/log-base-view.ts', import.meta.url),
    'utf8',
  );
  const tpsListSource = readFileSync(
    new URL('../src/tps-list/views/TpsListView.ts', import.meta.url),
    'utf8',
  );
  const tableDispatcher = methodSource(
    tableSource,
    'private openConfiguredPropertyCellEditor(',
    'private openConfiguredPropertyValuePicker(',
  );
  const tableStatusClassifier = methodSource(
    tableSource,
    'private isTaskStatusSelector(',
    'private createTaskLineContext(',
  );
  const listDispatcher = methodSource(
    tpsListSource,
    'private startListTaskPropertyEdit(',
    'private async openListTaskWorkflowStatusPicker(',
  );

  assert.ok(
    tableDispatcher.indexOf('propertyUsesEntityOptions(property)')
      < tableDispatcher.indexOf('this.isTaskStatusSelector(entry, property)'),
    'TPS Table must dispatch relational status to the entity picker before checkbox status',
  );
  assert.match(
    tableStatusClassifier,
    /if \(propertyUsesEntityOptions\(property\)\) return false;/u,
  );
  assert.match(
    listDispatcher,
    /const configuredProperty = this\.getConfiguredCustomProperty\(propName\)[\s\S]*?!propertyUsesEntityOptions\(configuredProperty\)[\s\S]*?this\.openListTaskWorkflowStatusPicker/u,
  );
  assert.ok(
    listDispatcher.indexOf('!propertyUsesEntityOptions(configuredProperty)')
      < listDispatcher.indexOf('this.openListTaskWorkflowStatusPicker'),
    'TPS List must reserve the workflow picker for nonentity status fields',
  );
  assert.match(
    listDispatcher,
    /this\.openListTaskEntityPicker\(file, task, configuredProperty, gcm\)/u,
  );
});

test('note workflow and recurrence services never treat relational status as checkbox state', () => {
  const bulkEditSource = readFileSync(
    new URL('../src/services/bulk-edit-service.ts', import.meta.url),
    'utf8',
  );
  const noteOperationSource = readFileSync(
    new URL('../src/services/note-operation-service.ts', import.meta.url),
    'utf8',
  );
  const subitemLineSource = readFileSync(
    new URL('../src/services/subitem-line-model.ts', import.meta.url),
    'utf8',
  );
  const reconcileSource = readFileSync(
    new URL('../src/services/task-status-checkbox-reconcile-service.ts', import.meta.url),
    'utf8',
  );
  const recurrenceSource = readFileSync(
    new URL('../src/services/recurrence-service.ts', import.meta.url),
    'utf8',
  );
  const eventSource = readFileSync(
    new URL('../src/events/register-events.ts', import.meta.url),
    'utf8',
  );
  const parentLinkSource = readFileSync(
    new URL('../src/handlers/parent-link-handler.ts', import.meta.url),
    'utf8',
  );
  const tpsListSource = readFileSync(
    new URL('../src/tps-list/views/TpsListView.ts', import.meta.url),
    'utf8',
  );
  const menuControllerSource = readFileSync(
    new URL('../src/menu/menu-controller.ts', import.meta.url),
    'utf8',
  );
  const homeCaptureSource = readFileSync(
    new URL('../src/services/home-capture-service.ts', import.meta.url),
    'utf8',
  );

  assert.match(
    bulkEditSource,
    /getWorkflowStatusKey\(\): string \{[\s\S]*?sharedServices\?\.status\?\.getStatusPropertyKey\?\.\(\)/u,
  );
  assert.match(
    bulkEditSource,
    /return this\.updateFrontmatter\([\s\S]{0,180}\{ \[this\.getWorkflowStatusKey\(\)\]: status \},[\s\S]{0,80}options/u,
  );
  assert.match(
    bulkEditSource,
    /const workflowStatusUpdate = Object\.entries\(updates \|\| \{\}\)\.find\([\s\S]*?workflowStatusKey\.toLowerCase\(\)/u,
  );
  assert.match(
    bulkEditSource,
    /SKIP_KEYS\.add\(this\.getWorkflowStatusKey\(\)\.toLowerCase\(\)\)/u,
    'recurrence propagation must skip only the workflow field, not a relational field named status',
  );
  assert.doesNotMatch(
    bulkEditSource,
    /(?:delete|set)FrontmatterValueCaseInsensitive\([^\n]*['"]status['"]/u,
    'recurrence mutations must not delete or overwrite a relational status field',
  );
  assert.match(
    noteOperationSource,
    /subitemRelationshipSyncService\.insertBodyLinkForChildWorkflow\(\s*dailyNote,\s*childFile,/u,
    'scheduled-note population must delegate workflow-key and checkbox mapping resolution to the shared relationship service',
  );
  assert.match(
    subitemLineSource,
    /sharedServices\?\.status\?\.getStatusPropertyKey\?\.\(\) \|\| 'status'/u,
  );
  assert.match(
    reconcileSource,
    /sharedServices\?\.status\?\.getStatusPropertyKey\?\.\(\) \|\| 'status'/u,
  );
  assert.doesNotMatch(
    recurrenceSource,
    /\bfm\.status\b/u,
    'recurrence reads must use the workflow status key rather than a relational status field',
  );
  assert.match(
    recurrenceSource,
    /private readWorkflowStatus\([\s\S]*?getStatusPropertyKey\?\.\(\)/u,
  );
  assert.match(
    eventSource,
    /const currentStatus = readConfiguredStatus\(frontmatter\);/u,
  );
  assert.match(
    eventSource,
    /const doneStatuses = new Set\(plugin\.sharedServices\.status\.getDoneStatuses\(\)\);/u,
  );
  assert.match(
    eventSource,
    /plugin\.frontmatterMutationService\.process\(file,/u,
  );
  assert.match(
    parentLinkSource,
    /this\.getWorkflowStatusValue\(fm\)/u,
  );
  assert.match(
    tpsListSource,
    /if \(!isRelationalStatusFilterExpression\(expr, this\.getGcmSettings\(\)\?\.properties\)\) \{[\s\S]*?evaluateTaskValueFilterExpression\(expr, 'status'/u,
  );
  assert.match(
    tpsListSource,
    /isReservedTaskDefaultKey\(rawKey\)[\s\S]{0,120}!this\.isRelationalStatusPropertyReference\(rawKey\)/u,
  );
  const legacyStatusMenu = methodSource(
    menuControllerSource,
    'openStatusSubmenu(',
    'openPrioritySubmenu(',
  );
  assert.match(
    legacyStatusMenu,
    /sharedServices\?\.status\?\.getStatusPropertyKey\?\.\(\) \|\| 'status'/u,
    'even the legacy status submenu must resolve the workflow key dynamically',
  );
  assert.doesNotMatch(
    legacyStatusMenu,
    /frontmatter\?\.status|frontmatter\.status/u,
    'the legacy submenu must not overwrite a relational status field',
  );
  const workoutPreview = methodSource(
    homeCaptureSource,
    'private formatWorkoutLogPreview(',
    'private async openWorkoutPath(',
  );
  assert.match(
    workoutPreview,
    /sharedServices\?\.status\?\.getStatusPropertyKey\?\.\(\) \|\| 'status'/u,
  );
  assert.match(
    workoutPreview,
    /sharedServices\?\.status\?\.normalize\(workflowStatus\)[\s\S]{0,160}normalizedWorkflowStatus === 'wont-do'/u,
  );
  assert.match(
    workoutPreview,
    /workflowStatusKey\.toLowerCase\(\) === 'status'[\s\S]{0,40}\? frontmatter\?\.status/u,
    'the legacy status fallback is allowed only when status is still the workflow key',
  );
});
