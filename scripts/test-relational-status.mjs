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
  const tableSource = readFileSync(
    new URL('../src/views/log-base-view.ts', import.meta.url),
    'utf8',
  );

  const checkboxMutation = methodSource(
    taskMenuSource,
    'private setTaskStatusCheckboxState(',
    'private showTaskEditorStatusMenu(',
  );
  assert.match(checkboxMutation, /findRelationalStatusProperty\(this\.plugin\.settings\.properties\)/u);
  assert.match(checkboxMutation, /=== relationalStatusKey\) continue;/u);
  assert.match(checkboxMutation, /setInlineFieldValueOnTaskLine\(next,\s*key,\s*null\)/u);

  const apiMutation = methodSource(
    taskApiSource,
    'private applyTaskInputToLine(',
    "if ('replaceTags' in input",
  );
  assert.match(
    apiMutation,
    /if \(!findRelationalStatusProperty\(this\.plugin\.settings\.properties\)\) \{[\s\S]*?setInlineFieldValueOnTaskLine\(next,\s*'status',\s*null\)/u,
  );
  assert.match(
    apiMutation,
    /key\.trim\(\)\.toLowerCase\(\) === 'status'[\s\S]*?&& !findRelationalStatusProperty\(this\.plugin\.settings\.properties\)/u,
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
    /queryFields\[normalizeInlineKey\(relationalStatus\.key\)\] = fields\[[\s\S]{0,120}normalizeInlineKey\(relationalStatus\.key\)[\s\S]{0,40}\];/u,
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
    /return this\.updateFrontmatter\(files, \{ \[this\.getWorkflowStatusKey\(\)\]: status \}\);/u,
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
    /sharedServices\?\.status\?\.getStatusPropertyKey\?\.\(\) \|\| ['"]status['"]/u,
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
    /const currentStatus = readConfiguredStatus\(fm\);/u,
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
