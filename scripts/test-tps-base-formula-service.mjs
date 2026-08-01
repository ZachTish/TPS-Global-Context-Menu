import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

async function loadModule() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/services/tps-base-formula-service.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const context = {
  row: {
    kind: 'task',
    title: '  ship FORMULAS  ',
    points: '4',
    tags: ['#beta', '#alpha', '#alpha'],
    scheduled: '2026-08-10',
    owner: '',
    'Property With Spaces': 'works',
  },
  note: {
    kind: 'project',
    points: 99,
    parentPoints: 3,
    owner: 'Source owner',
  },
  file: {
    path: 'Inbox/Formula QA.md',
    name: 'Formula QA.md',
    basename: 'Formula QA',
    extension: 'md',
    folder: 'Inbox',
    size: 123,
    ctime: '2026-08-01 10:00:00',
    mtime: '2026-08-09 11:30:00',
    tags: ['#qa/nested', '#formula'],
    links: ['[[Other]]'],
    properties: { status: 'active' },
  },
  thisValue: {
    scheduled: '2026-08-10',
    file: {
      path: 'Daily Notes/2026-08-10.md',
      name: '2026-08-10.md',
      basename: '2026-08-10',
      extension: 'md',
      folder: 'Daily Notes',
    },
  },
  task: { status: 'working', open: true, done: false },
  line: { number: 7, title: 'ship FORMULAS' },
  heading: null,
  now: new Date(2026, 7, 10, 12, 0, 0),
};

function value(session, name) {
  const result = session.get(name);
  assert.ok(['value', 'empty'].includes(result.status), `${name}: ${result.code || result.message || result.status}`);
  return result.value;
}

test('formula definitions are extracted without coercing unsafe values', async () => {
  const { extractTpsBaseFormulaDefinitions } = await loadModule();
  assert.deepEqual(extractTpsBaseFormulaDefinitions({ formulas: { good: 'points * 2', numeric: 4, nested: {} } }), { good: 'points * 2' });
  assert.deepEqual(extractTpsBaseFormulaDefinitions(null), {});
});

test('the public GCM Formula API v1 exposes one supported consumer contract without dynamic evaluation', () => {
  const apiSource = readFileSync(new URL('../src/plugin-api.ts', import.meta.url), 'utf8');
  const evaluatorSource = readFileSync(new URL('../src/services/tps-base-formula-service.ts', import.meta.url), 'utf8');
  for (const method of [
    'compile',
    'createSession',
    'evaluate',
    'evaluateAll',
    'evaluateExpression',
    'format',
    'comparableValues',
    'sortKey',
    'groupValues',
    'compare',
    'isTruthy',
    'hasReference',
  ]) assert.match(apiSource, new RegExp(`\\b${method}:`));
  assert.doesNotMatch(evaluatorSource, /\beval\s*\(|\bnew\s+Function\b/u);
  assert.doesNotMatch(evaluatorSource, /queryController|monkey|workspace\.trigger/u);
});

test('row properties win bare lookup while note namespace stays source-only', async () => {
  const { tpsBaseFormulaService } = await loadModule();
  const compiled = tpsBaseFormulaService.compile({
    effective_kind: 'kind',
    source_kind: 'note.kind',
    row_points: 'number(points)',
    note_points: 'number(note.points)',
    spaced: 'row["Property With Spaces"]',
  }, 'scope-test');
  const session = tpsBaseFormulaService.createSession(compiled, context);
  assert.equal(value(session, 'effective_kind'), 'task');
  assert.equal(value(session, 'source_kind'), 'project');
  assert.equal(value(session, 'row_points'), 4);
  assert.equal(value(session, 'note_points'), 99);
  assert.equal(value(session, 'spaced'), 'works');
});

test('operator precedence, comparisons, booleans, ternaries, and lazy if match the supported contract', async () => {
  const { tpsBaseFormulaService } = await loadModule();
  const compiled = tpsBaseFormulaService.compile({
    arithmetic: '2 + 3 * 4 - 5 % 2',
    compact_arithmetic: 'number(points)-1',
    numeric_method: '123.toString()',
    comparison: 'number(points) >= 4 && note.kind != "task"',
    short_circuit: 'true || unknownFunction()',
    lazy_if: 'if(owner.isEmpty(), "Unowned", unknownFunction())',
    ternary: 'task.open ? "open" : "closed"',
    unary: '-number(points) + +2',
  });
  const session = tpsBaseFormulaService.createSession(compiled, context);
  assert.equal(value(session, 'arithmetic'), 13);
  assert.equal(value(session, 'compact_arithmetic'), 3);
  assert.equal(value(session, 'numeric_method'), '123');
  assert.equal(value(session, 'comparison'), true);
  assert.equal(value(session, 'short_circuit'), true);
  assert.equal(value(session, 'lazy_if'), 'Unowned');
  assert.equal(value(session, 'ternary'), 'open');
  assert.equal(value(session, 'unary'), -2);
});

test('formula-aware filter expressions reuse the compiled dependency graph and typed truthiness', async () => {
  const { hasTpsFormulaReference, tpsBaseFormulaService } = await loadModule();
  const compiled = tpsBaseFormulaService.compile({
    total: 'number(points) + number(note.parentPoints)',
    ready: 'formula.total >= 7',
  }, 'filter-expression');
  const session = tpsBaseFormulaService.createSession(compiled, context);
  assert.equal(session.evaluateExpression('formula.ready && task.open', '$filter').value, true);
  assert.equal(session.evaluateExpression('formula.total < 7', '$filter').value, false);
  assert.equal(session.evaluateExpression('formula.missing', '$filter').code, 'unknown-formula');
  assert.equal(hasTpsFormulaReference({ and: ['kind == "task"', 'formula.ready'] }), true);
  assert.equal(hasTpsFormulaReference({ and: ['formula["Total Cost"] > 1'] }), true);
  assert.equal(hasTpsFormulaReference('title == "formula.fake"'), false);
  assert.equal(hasTpsFormulaReference('/formula\\.fake/u.test(title)'), false);
  assert.equal(hasTpsFormulaReference({ property: 'title', operator: 'is', value: 'formula.fake' }), false);
  assert.equal(hasTpsFormulaReference({ property: 'formula.ready', operator: 'is', value: true }), true);
  assert.equal(hasTpsFormulaReference({ and: ['kind == "task"'] }), false);
  const circular = {};
  circular.self = circular;
  assert.equal(hasTpsFormulaReference(circular), false);
  assert.equal(tpsBaseFormulaService.hasReference({ property: 'formula.ready' }), true);
});

test('dependent formulas memoize values, support forward references, and reject cycles', async () => {
  const { tpsBaseFormulaService } = await loadModule();
  const compiled = tpsBaseFormulaService.compile({
    doubled: 'formula.total * 2',
    total: 'number(points) + number(note.parentPoints)',
    diamond: 'formula.total + formula.doubled + formula.total',
    direct_cycle: 'formula.direct_cycle',
    cycle_a: 'formula.cycle_b',
    cycle_b: 'formula.cycle_a',
  });
  const session = tpsBaseFormulaService.createSession(compiled, context);
  assert.equal(value(session, 'doubled'), 14);
  assert.equal(value(session, 'diamond'), 28);
  assert.equal(session.get('direct_cycle').code, 'formula-cycle');
  assert.equal(session.get('cycle_a').code, 'formula-cycle');
  assert.equal(session.get('missing').code, 'unknown-formula');
});

test('string, number, object, and regular expression functions are deterministic', async () => {
  const { tpsBaseFormulaService } = await loadModule();
  const compiled = tpsBaseFormulaService.compile({
    text: 'title.trim().lower().title()',
    contains: 'title.containsAll("ship", "FORM") && title.containsAny("x", "ship")',
    boundaries: '"hello".startsWith("he") && "hello".endsWith("lo")',
    replace: '"a:b:c".replace(/:/g, "-")',
    split: '"a,b,c,d".split(",", 3).join("|")',
    reversed: '"abc".repeat(2).reverse().slice(1, 5)',
    numeric: '(-2.345).abs().round(2).toFixed(2)',
    rounding: '(2.1).ceil() + (2.9).floor()',
    regex: '/^ship/i.matches(title.trim())',
    object_keys: '{a: 1, b: 2}.keys().sort().join(",")',
    object_values: '{a: 1, b: 2}.values().reduce(acc + value, 0)',
    escaped: 'escapeHTML("<b>&</b>")',
  });
  const session = tpsBaseFormulaService.createSession(compiled, context);
  assert.equal(value(session, 'text'), 'Ship Formulas');
  assert.equal(value(session, 'contains'), true);
  assert.equal(value(session, 'boundaries'), true);
  assert.equal(value(session, 'replace'), 'a-b-c');
  assert.equal(value(session, 'split'), 'a|b|c');
  assert.equal(value(session, 'reversed'), 'bacb');
  assert.equal(value(session, 'numeric'), '2.35');
  assert.equal(value(session, 'rounding'), 5);
  assert.equal(value(session, 'regex'), true);
  assert.equal(value(session, 'object_keys'), 'a,b');
  assert.equal(value(session, 'object_values'), 3);
  assert.equal(value(session, 'escaped'), '&lt;b&gt;&amp;&lt;/b&gt;');
});

test('list functions and higher-order expressions use bounded row-local scopes', async () => {
  const { tpsBaseFormulaService } = await loadModule();
  const compiled = tpsBaseFormulaService.compile({
    normalized_tags: 'list(tags).unique().sort().join(", ")',
    transformed: '[1, 2, 3, 4].filter(value > 2).map(value * 10).join(",")',
    reduced: '[1, 2, 3, 4].reduce(acc + value, 0)',
    indexed: '[10, 10, 10].map(value + index).join(",")',
    flattened: '[1, [2, [3]]].flat().join(",")',
    contains: '[1, 2, 3].contains(2) && [1, 2, 3].containsAll(1, 3) && [1, 2].containsAny(0, 2)',
    sliced: '[1, 2, 3, 4].reverse().slice(1, 3).join(",")',
  });
  const session = tpsBaseFormulaService.createSession(compiled, context);
  assert.equal(value(session, 'normalized_tags'), '#alpha, #beta');
  assert.equal(value(session, 'transformed'), '30,40');
  assert.equal(value(session, 'reduced'), 10);
  assert.equal(value(session, 'indexed'), '10,11,12');
  assert.equal(value(session, 'flattened'), '1,2,3');
  assert.equal(value(session, 'contains'), true);
  assert.equal(value(session, 'sliced'), '3,2');
});

test('date and duration arithmetic matches documented Bases elapsed-time semantics', async () => {
  const { tpsBaseFormulaService, formatTpsFormulaValue } = await loadModule();
  const compiled = tpsBaseFormulaService.compile({
    next_day: 'date(scheduled) + "1d"',
    previous_hour: 'now() - duration("1h")',
    month_rollover: 'date("2026-01-31") + "1M"',
    dst_day: 'date("2026-03-08") + "1d"',
    date_parts: 'date(scheduled).year + date(scheduled).month + date(scheduled).day',
    formatted: 'date(scheduled).format("ddd, MMM D YYYY")',
    time: 'now().time()',
    date_only: 'now().date()',
    difference: 'date("2026-08-12") - date("2026-08-10")',
    dst_elapsed: 'number(date("2026-03-08") + "1d") - number(date("2026-03-08"))',
    scaled: 'now() + (duration("2h") * 3)',
  });
  const session = tpsBaseFormulaService.createSession(compiled, context);
  assert.equal(formatTpsFormulaValue(value(session, 'next_day')), '2026-08-11');
  assert.equal(formatTpsFormulaValue(value(session, 'previous_hour')), '2026-08-10 11:00:00');
  assert.equal(value(session, 'date_parts'), 2044);
  assert.equal(value(session, 'formatted'), 'Mon, Aug 10 2026');
  assert.equal(value(session, 'time'), '12:00:00');
  assert.equal(formatTpsFormulaValue(value(session, 'date_only')), '2026-08-10');
  assert.equal(value(session, 'difference'), 172800000);
  assert.equal(value(session, 'dst_elapsed'), 86_400_000);
  assert.equal(formatTpsFormulaValue(value(session, 'scaled')), '2026-08-10 18:00:00');
  assert.equal(formatTpsFormulaValue(value(session, 'month_rollover')), '2026-02-28');
  assert.equal(formatTpsFormulaValue(value(session, 'dst_day')), '2026-03-09 01:00:00');
});

test('file, this, task, line, links, and structural namespaces remain distinct', async () => {
  const { tpsBaseFormulaService, formatTpsFormulaValue } = await loadModule();
  const compiled = tpsBaseFormulaService.compile({
    path: 'file.path',
    context_path: 'this.file.path',
    workflow: 'if(task.open, task.status, "done")',
    line_number: 'line.number',
    file_checks: 'file.inFolder("Inbox") && file.hasTag("qa") && file.hasProperty("status")',
    file_link: 'file.asLink("Source")',
    explicit_link: 'link(file.path, title.trim())',
    context_link_identity: 'link(this.file.path) == this',
    file_date: 'file.mtime.format("YYYY-MM-DD HH:mm")',
  });
  const session = tpsBaseFormulaService.createSession(compiled, context);
  assert.equal(value(session, 'path'), 'Inbox/Formula QA.md');
  assert.equal(value(session, 'context_path'), 'Daily Notes/2026-08-10.md');
  assert.equal(value(session, 'workflow'), 'working');
  assert.equal(value(session, 'line_number'), 7);
  assert.equal(value(session, 'file_checks'), true);
  assert.equal(formatTpsFormulaValue(value(session, 'file_link')), 'Source');
  assert.equal(formatTpsFormulaValue(value(session, 'explicit_link')), 'ship FORMULAS');
  assert.equal(value(session, 'context_link_identity'), true);
  assert.equal(value(session, 'file_date'), '2026-08-09 11:30');
});

test('typed comparison, grouping, and sort adapters preserve Date, Duration, and Link identity', async () => {
  const {
    compareTpsFormulaValues,
    getTpsFormulaGroupValues,
    getTpsFormulaSortKey,
    isTpsFormulaTruthy,
    tpsBaseFormulaService,
  } = await loadModule();
  const compiled = tpsBaseFormulaService.compile({
    day: 'date("2026-08-10")',
    span: 'duration("1d")',
    owner: 'link("People/Ada.md", "Ada")',
  });
  const session = tpsBaseFormulaService.createSession(compiled, context);
  const day = value(session, 'day');
  const span = value(session, 'span');
  const owner = value(session, 'owner');

  class PublicBasesValue {
    constructor(raw) { this.raw = raw; }
    toString() { return String(this.raw); }
    isTruthy() { return Boolean(this.raw); }
  }
  class PublicNumberValue extends PublicBasesValue { static type = 'number'; }
  class PublicDateValue extends PublicBasesValue { static type = 'date'; }
  class PublicLinkValue extends PublicBasesValue { static type = 'link'; }
  class PublicBooleanValue extends PublicBasesValue { static type = 'boolean'; }
  class PublicObjectValue extends PublicBasesValue { static type = 'object'; }
  class PublicRegExpValue extends PublicBasesValue { static type = 'regexp'; }
  class PublicHtmlValue extends PublicBasesValue { static type = 'html'; }
  class PublicUnknownValue extends PublicBasesValue { static type = 'chart'; }
  class PublicListValue extends PublicBasesValue {
    static type = 'list';
    length() { return this.raw.length; }
    get(index) { return this.raw[index]; }
    toString() { return 'opaque-native-list'; }
  }
  assert.equal(compareTpsFormulaValues(day, '2026-08-10'), 0);
  assert.equal(compareTpsFormulaValues(span, '1d'), 0);
  assert.equal(compareTpsFormulaValues(owner, '[[People/Ada]]'), 0);
  assert.deepEqual(getTpsFormulaGroupValues([day, span, owner]), [
    '2026-08-10',
    '86400000',
    'People/Ada.md',
  ]);
  assert.equal(getTpsFormulaSortKey(span), getTpsFormulaSortKey(86_400_000));
  assert.equal(getTpsFormulaSortKey(new PublicNumberValue(10)), getTpsFormulaSortKey(10));
  assert.equal(getTpsFormulaSortKey(new PublicDateValue('2026-08-10')), getTpsFormulaSortKey(day));
  assert.equal(compareTpsFormulaValues(new PublicLinkValue('[[People/Ada.md|Ada]]'), owner), 0);
  assert.deepEqual(getTpsFormulaGroupValues(new PublicBooleanValue(false)), ['false']);
  assert.equal(isTpsFormulaTruthy([]), true, 'plain empty lists use JavaScript/Bases boolean coercion');
  assert.equal(
    isTpsFormulaTruthy(new PublicListValue([])),
    true,
    'native ListValue truthiness delegates to the public isTruthy() contract',
  );
  assert.deepEqual(
    getTpsFormulaGroupValues(new PublicObjectValue('{"priority":1}')),
    ['{"priority":1}'],
    'ObjectValue uses only its public textual representation instead of private fields',
  );
  assert.deepEqual(getTpsFormulaGroupValues(new PublicRegExpValue('/ship\\/it/gi')), ['/ship\\/it/gi']);
  assert.deepEqual(getTpsFormulaGroupValues(new PublicHtmlValue('<strong>Ready</strong>')), ['<strong>Ready</strong>']);
  assert.throws(
    () => getTpsFormulaGroupValues(new PublicObjectValue('[object Object]')),
    (error) => error?.code === 'unsupported-native-value',
    'an opaque ObjectValue must not silently collapse to {} or a private wrapper shape',
  );
  assert.throws(
    () => getTpsFormulaGroupValues(new PublicUnknownValue('chart output')),
    (error) => error?.code === 'unsupported-native-value',
    'unknown Value subclasses fail explicitly instead of masquerading as canonical data',
  );
  const nativeList = new PublicListValue([
    new PublicLinkValue('[[People/Ada.md|Ada]]'),
    new PublicBooleanValue(false),
    new PublicListValue([new PublicNumberValue(10)]),
  ]);
  assert.deepEqual(
    getTpsFormulaGroupValues(nativeList),
    ['People/Ada.md', 'false', '10'],
    'public ListValue members are read through length()/get() and retain nested typed identity',
  );
  assert.equal(
    getTpsFormulaSortKey(nativeList),
    getTpsFormulaSortKey([
      { __tpsFormulaType: 'link', path: 'People/Ada.md', display: 'Ada' },
      false,
      [10],
    ]),
  );
});

test('empty, error, unsupported, malformed, and unsafe expressions remain explicit', async () => {
  const { tpsBaseFormulaService } = await loadModule();
  const compiled = tpsBaseFormulaService.compile({
    empty: 'owner',
    missing: 'doesNotExist',
    malformed: 'points + (',
    unknown: 'unknownFunction(points)',
    unsafe_random: 'random()',
    unsafe_html: 'html(title)',
    divide_zero: '1 / 0',
    invalid_date: 'date("not-a-date")',
    unresolved_link: 'link("Other").asFile()',
    oversized: '"1234567890".repeat(10001)',
    wrong_args: 'title.trim("ignored")',
    unsafe_regexp: '/(a+)+$/.matches(title)',
    unsupported_backlinks: 'file.backlinks',
  });
  const session = tpsBaseFormulaService.createSession(compiled, context);
  assert.equal(session.get('empty').status, 'empty');
  assert.equal(session.get('missing').status, 'empty');
  assert.equal(session.get('malformed').code, 'syntax-error');
  assert.equal(session.get('unknown').status, 'unsupported');
  assert.equal(session.get('unsafe_random').code, 'unsupported-function');
  assert.equal(session.get('unsafe_html').status, 'unsupported');
  assert.equal(session.get('divide_zero').code, 'divide-by-zero');
  assert.equal(session.get('invalid_date').code, 'invalid-date');
  assert.equal(session.get('unresolved_link').code, 'unsupported-link-resolution');
  assert.equal(session.get('oversized').code, 'output-too-large');
  assert.equal(session.get('wrong_args').code, 'wrong-argument-count');
  assert.equal(session.get('unsafe_regexp').code, 'unsafe-regexp');
  assert.equal(session.get('unsupported_backlinks').code, 'unsupported-file-index');
});

test('definition, collection, and cyclic formatting limits fail explicitly without blocking the UI thread', async () => {
  const { formatTpsFormulaValue, tpsBaseFormulaService } = await loadModule();
  const definitions = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`f${index}`, String(index)]));
  const compiled = tpsBaseFormulaService.compile(definitions, 'bounded-definitions');
  const session = tpsBaseFormulaService.createSession(compiled, {
    ...context,
    row: {
      ...context.row,
      oversized: Array.from({ length: 10_001 }, (_, index) => index),
      huge: 'x'.repeat(100_001),
      half: 'x'.repeat(60_000),
    },
  });
  assert.equal(session.get('f255').value, 255);
  assert.equal(session.get('f256').code, 'too-many-formulas');
  assert.equal(session.evaluateExpression('oversized.unique()', '$bounded').code, 'collection-too-large');
  assert.equal(session.evaluateExpression('huge', '$direct-string-bound').code, 'output-too-large');
  assert.equal(session.evaluateExpression('huge.lower()', '$input-string-bound').code, 'input-too-large');
  assert.equal(session.evaluateExpression('half + half', '$concat-string-bound').code, 'output-too-large');
  const cyclic = { label: 'root' };
  cyclic.self = cyclic;
  assert.match(formatTpsFormulaValue(cyclic), /Circular/u);
});

test('compilation is reused and row evaluation remains isolated at scale', async () => {
  const { tpsBaseFormulaService } = await loadModule();
  const definitions = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`f${index}`, index === 0 ? 'number(points)' : `formula.f${index - 1} + 1`]));
  const first = tpsBaseFormulaService.compile(definitions, 'benchmark');
  const second = tpsBaseFormulaService.compile({ ...definitions }, 'benchmark');
  assert.equal(first, second);
  let checksum = 0;
  for (let index = 0; index < 5_000; index += 1) {
    const session = tpsBaseFormulaService.createSession(first, { ...context, row: { ...context.row, points: String(index) } });
    checksum += value(session, 'f11');
  }
  assert.equal(checksum, 12552500);

  const primitiveList = Array.from({ length: 10_000 }, (_, index) => index);
  const listSet = tpsBaseFormulaService.compile({ count: 'items.unique().length' }, 'primitive-unique-scale');
  const listSession = tpsBaseFormulaService.createSession(listSet, {
    ...context,
    row: { ...context.row, items: primitiveList },
  });
  assert.equal(value(listSession, 'count'), 10_000);
});
