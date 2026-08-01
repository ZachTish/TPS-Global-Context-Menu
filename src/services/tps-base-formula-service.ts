export const TPS_FORMULA_API_VERSION = 1 as const;

const MAX_EXPRESSION_LENGTH = 8_192;
const MAX_TOKENS = 2_048;
const MAX_PARSE_DEPTH = 64;
const MAX_DEPENDENCY_DEPTH = 64;
const MAX_COLLECTION_ITERATIONS = 10_000;
const MAX_FORMULA_DEFINITIONS = 256;
const MAX_TOTAL_DEFINITION_LENGTH = 262_144;
const MAX_COMPILED_CACHE_ENTRIES = 32;
const MAX_COMPILED_EXPRESSION_CACHE_ENTRIES = 128;
const MAX_RUNTIME_STRING_LENGTH = 100_000;
const MAX_REGEXP_SOURCE_LENGTH = 512;
const MAX_REGEXP_INPUT_LENGTH = 100_000;

export type TpsFormulaDefinitions = Record<string, string>;

export type TpsFormulaFileContext = {
  path: string;
  name?: string;
  basename?: string;
  extension?: string;
  ext?: string;
  folder?: string;
  size?: number;
  ctime?: Date | number | string;
  mtime?: Date | number | string;
  tags?: unknown[];
  links?: unknown[];
  properties?: Record<string, unknown>;
};

export type TpsFormulaRecordContext = {
  row?: Record<string, unknown>;
  note?: Record<string, unknown>;
  file?: TpsFormulaFileContext | null;
  thisValue?: Record<string, unknown> | null;
  task?: Record<string, unknown> | null;
  line?: Record<string, unknown> | null;
  heading?: Record<string, unknown> | null;
  external?: Record<string, unknown> | null;
  now?: Date | number | string;
};

export type TpsFormulaResultStatus = 'value' | 'empty' | 'unsupported' | 'error';

export type TpsFormulaResult = {
  status: TpsFormulaResultStatus;
  value: unknown;
  formula: string;
  code?: string;
  message?: string;
};

type TokenType =
  | 'number'
  | 'string'
  | 'identifier'
  | 'regexp'
  | 'operator'
  | 'punctuation'
  | 'eof';

type Token = {
  type: TokenType;
  value: string;
  position: number;
  literal?: unknown;
};

type LiteralNode = { type: 'literal'; value: unknown };
type IdentifierNode = { type: 'identifier'; name: string };
type ArrayNode = { type: 'array'; elements: AstNode[] };
type ObjectNode = { type: 'object'; entries: Array<{ key: string; value: AstNode }> };
type UnaryNode = { type: 'unary'; operator: string; argument: AstNode };
type BinaryNode = { type: 'binary'; operator: string; left: AstNode; right: AstNode };
type ConditionalNode = { type: 'conditional'; test: AstNode; consequent: AstNode; alternate: AstNode };
type MemberNode = { type: 'member'; object: AstNode; property: AstNode; computed: boolean };
type CallNode = { type: 'call'; callee: AstNode; args: AstNode[] };
type AstNode = LiteralNode | IdentifierNode | ArrayNode | ObjectNode | UnaryNode | BinaryNode | ConditionalNode | MemberNode | CallNode;

type CompiledProgram = {
  expression: string;
  ast: AstNode | null;
  error?: TpsFormulaFailure;
};

export type TpsCompiledFormulaSet = {
  readonly version: typeof TPS_FORMULA_API_VERSION;
  readonly sourceId: string;
  readonly revision: string;
  readonly definitions: Readonly<TpsFormulaDefinitions>;
  readonly programs: ReadonlyMap<string, CompiledProgram>;
  readonly namesByLowerCase: ReadonlyMap<string, string>;
};

type TpsDurationValue = {
  readonly __tpsFormulaType: 'duration';
  readonly years: number;
  readonly months: number;
  readonly weeks: number;
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly milliseconds: number;
};

export type TpsFormulaLinkValue = {
  readonly __tpsFormulaType: 'link';
  readonly path: string;
  readonly display?: unknown;
};

type TpsRuntimeFileValue = TpsFormulaFileContext & {
  readonly __tpsFormulaType: 'file';
};

type FormulaNamespace = { readonly __tpsFormulaType: 'formula-namespace' };

type EvaluationScope = Record<string, unknown>;

class TpsFormulaFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly unsupported = false,
  ) {
    super(message);
    this.name = 'TpsFormulaFailure';
  }
}

const FORMULA_NAMESPACE: FormulaNamespace = Object.freeze({ __tpsFormulaType: 'formula-namespace' });

const BINARY_PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '===': 3,
  '!==': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

function tokenize(expression: string): Token[] {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new TpsFormulaFailure('expression-too-long', `Formula exceeds ${MAX_EXPRESSION_LENGTH} characters`);
  }
  const tokens: Token[] = [];
  let index = 0;
  let canStartRegexp = true;
  const push = (token: Token) => {
    tokens.push(token);
    if (tokens.length > MAX_TOKENS) throw new TpsFormulaFailure('too-many-tokens', `Formula exceeds ${MAX_TOKENS} tokens`);
    if (token.type === 'number' || token.type === 'string' || token.type === 'identifier' || token.type === 'regexp') {
      canStartRegexp = false;
    } else if (token.type === 'punctuation') {
      canStartRegexp = token.value !== ')' && token.value !== ']';
    } else if (token.type === 'operator') {
      canStartRegexp = true;
    }
  };

  while (index < expression.length) {
    const ch = expression[index];
    if (/\s/u.test(ch)) {
      index += 1;
      continue;
    }
    const position = index;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      index += 1;
      let value = '';
      let closed = false;
      while (index < expression.length) {
        const current = expression[index++];
        if (current === quote) {
          closed = true;
          break;
        }
        if (current !== '\\') {
          value += current;
          continue;
        }
        if (index >= expression.length) break;
        const escaped = expression[index++];
        if (escaped === 'n') value += '\n';
        else if (escaped === 'r') value += '\r';
        else if (escaped === 't') value += '\t';
        else if (escaped === 'b') value += '\b';
        else if (escaped === 'f') value += '\f';
        else if (escaped === 'v') value += '\v';
        else if (escaped === 'u') {
          const hex = expression.slice(index, index + 4);
          if (!/^[0-9a-f]{4}$/iu.test(hex)) throw new TpsFormulaFailure('invalid-string-escape', `Invalid Unicode escape at ${index - 2}`);
          value += String.fromCharCode(Number.parseInt(hex, 16));
          index += 4;
        } else value += escaped;
      }
      if (!closed) throw new TpsFormulaFailure('unterminated-string', `Unterminated string at ${position}`);
      push({ type: 'string', value, literal: value, position });
      continue;
    }
    if (/\d/u.test(ch) || (ch === '.' && /\d/u.test(expression[index + 1] || ''))) {
      // Keep the property-access dot in `1.toString()` separate from the
      // numeric token. Decimal literals still require digits after the dot.
      const match = expression.slice(index).match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/u);
      if (!match) throw new TpsFormulaFailure('invalid-number', `Invalid number at ${position}`);
      index += match[0].length;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw new TpsFormulaFailure('invalid-number', `Invalid number at ${position}`);
      push({ type: 'number', value: match[0], literal: value, position });
      continue;
    }
    if (/[A-Za-z_$]/u.test(ch)) {
      // A hyphen is always subtraction in the formula language. Properties
      // whose names contain punctuation remain available through bracket
      // access, for example `row["follow-up"]`.
      const match = expression.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/u)!;
      index += match[0].length;
      push({ type: 'identifier', value: match[0], position });
      continue;
    }
    if (ch === '/' && canStartRegexp) {
      index += 1;
      let source = '';
      let inClass = false;
      let closed = false;
      while (index < expression.length) {
        const current = expression[index++];
        if (current === '\\') {
          if (index >= expression.length) break;
          source += current + expression[index++];
          continue;
        }
        if (current === '[') inClass = true;
        if (current === ']') inClass = false;
        if (current === '/' && !inClass) {
          closed = true;
          break;
        }
        source += current;
      }
      if (!closed) throw new TpsFormulaFailure('unterminated-regexp', `Unterminated regular expression at ${position}`);
      const flagsMatch = expression.slice(index).match(/^[dgimsuvy]*/u);
      const flags = flagsMatch?.[0] || '';
      index += flags.length;
      try {
        assertSafeRegExpSource(source);
        push({ type: 'regexp', value: `/${source}/${flags}`, literal: new RegExp(source, flags), position });
      } catch (error) {
        if (error instanceof TpsFormulaFailure) throw error;
        throw new TpsFormulaFailure('invalid-regexp', error instanceof Error ? error.message : String(error));
      }
      continue;
    }
    const operator = ['===', '!==', '>=', '<=', '==', '!=', '&&', '||'].find((candidate) => expression.startsWith(candidate, index));
    if (operator) {
      index += operator.length;
      push({ type: 'operator', value: operator, position });
      continue;
    }
    if ('+-*/%<>!'.includes(ch)) {
      index += 1;
      push({ type: 'operator', value: ch, position });
      continue;
    }
    if ('()[]{}.,?:'.includes(ch)) {
      index += 1;
      push({ type: 'punctuation', value: ch, position });
      continue;
    }
    throw new TpsFormulaFailure('unexpected-character', `Unexpected character ${JSON.stringify(ch)} at ${position}`);
  }
  tokens.push({ type: 'eof', value: '', position: expression.length });
  return tokens;
}

function assertSafeRegExpSource(source: string): void {
  if (source.length > MAX_REGEXP_SOURCE_LENGTH) {
    throw new TpsFormulaFailure('regexp-too-long', `Regular expression exceeds ${MAX_REGEXP_SOURCE_LENGTH} characters`);
  }
  // Synthetic rows are evaluated in the UI thread. Reject constructs that
  // commonly permit exponential backtracking instead of pretending they are
  // safe merely because JavaScript accepts them.
  if (/\\[1-9]/u.test(source) || /\(\?<!?/u.test(source) || /\([^)]*[+*][^)]*\)\s*(?:[+*]|\{)/u.test(source)) {
    throw new TpsFormulaFailure(
      'unsafe-regexp',
      'Regular expression uses backreferences, lookbehind, or nested quantifiers that are unsafe for row evaluation',
      true,
    );
  }
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): AstNode {
    const result = this.parseExpression(0);
    const token = this.peek();
    if (token.type !== 'eof') throw this.failure(token, `Unexpected token ${token.value}`);
    return result;
  }

  private parseExpression(minPrecedence: number): AstNode {
    this.enter();
    try {
      let left = this.parseUnary();
      while (true) {
        const token = this.peek();
        const precedence = token.type === 'operator' ? BINARY_PRECEDENCE[token.value] : undefined;
        if (precedence == null || precedence < minPrecedence) break;
        this.index += 1;
        const right = this.parseExpression(precedence + 1);
        left = { type: 'binary', operator: token.value, left, right };
      }
      if (minPrecedence === 0 && this.matchPunctuation('?')) {
        const consequent = this.parseExpression(0);
        this.expectPunctuation(':');
        const alternate = this.parseExpression(0);
        left = { type: 'conditional', test: left, consequent, alternate };
      }
      return left;
    } finally {
      this.leave();
    }
  }

  private parseUnary(): AstNode {
    const token = this.peek();
    if (token.type === 'operator' && ['!', '+', '-'].includes(token.value)) {
      this.index += 1;
      return { type: 'unary', operator: token.value, argument: this.parseUnary() };
    }
    return this.parsePostfix(this.parsePrimary());
  }

  private parsePostfix(base: AstNode): AstNode {
    let node = base;
    while (true) {
      if (this.matchPunctuation('.')) {
        const property = this.next();
        if (property.type !== 'identifier') throw this.failure(property, 'Expected a property name after .');
        node = { type: 'member', object: node, property: { type: 'literal', value: property.value }, computed: false };
        continue;
      }
      if (this.matchPunctuation('[')) {
        const property = this.parseExpression(0);
        this.expectPunctuation(']');
        node = { type: 'member', object: node, property, computed: true };
        continue;
      }
      if (this.matchPunctuation('(')) {
        const args: AstNode[] = [];
        if (!this.matchPunctuation(')')) {
          do args.push(this.parseExpression(0)); while (this.matchPunctuation(','));
          this.expectPunctuation(')');
        }
        node = { type: 'call', callee: node, args };
        continue;
      }
      break;
    }
    return node;
  }

  private parsePrimary(): AstNode {
    const token = this.next();
    if (token.type === 'number' || token.type === 'string' || token.type === 'regexp') {
      return { type: 'literal', value: token.literal };
    }
    if (token.type === 'identifier') {
      if (token.value === 'true') return { type: 'literal', value: true };
      if (token.value === 'false') return { type: 'literal', value: false };
      if (token.value === 'null' || token.value === 'undefined') return { type: 'literal', value: null };
      return { type: 'identifier', name: token.value };
    }
    if (token.type === 'punctuation' && token.value === '(') {
      const result = this.parseExpression(0);
      this.expectPunctuation(')');
      return result;
    }
    if (token.type === 'punctuation' && token.value === '[') {
      const elements: AstNode[] = [];
      if (!this.matchPunctuation(']')) {
        do elements.push(this.parseExpression(0)); while (this.matchPunctuation(','));
        this.expectPunctuation(']');
      }
      return { type: 'array', elements };
    }
    if (token.type === 'punctuation' && token.value === '{') {
      const entries: Array<{ key: string; value: AstNode }> = [];
      if (!this.matchPunctuation('}')) {
        do {
          const key = this.next();
          if (!['identifier', 'string', 'number'].includes(key.type)) throw this.failure(key, 'Expected an object key');
          this.expectPunctuation(':');
          entries.push({ key: String(key.literal ?? key.value), value: this.parseExpression(0) });
        } while (this.matchPunctuation(','));
        this.expectPunctuation('}');
      }
      return { type: 'object', entries };
    }
    throw this.failure(token, token.type === 'eof' ? 'Unexpected end of formula' : `Unexpected token ${token.value}`);
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  private matchPunctuation(value: string): boolean {
    const token = this.peek();
    if (token.type !== 'punctuation' || token.value !== value) return false;
    this.index += 1;
    return true;
  }

  private expectPunctuation(value: string): void {
    const token = this.next();
    if (token.type !== 'punctuation' || token.value !== value) throw this.failure(token, `Expected ${value}`);
  }

  private failure(token: Token, message: string): TpsFormulaFailure {
    return new TpsFormulaFailure('syntax-error', `${message} at ${token.position}`);
  }

  private enter(): void {
    this.depth += 1;
    if (this.depth > MAX_PARSE_DEPTH) throw new TpsFormulaFailure('expression-too-deep', `Formula exceeds ${MAX_PARSE_DEPTH} levels`);
  }

  private leave(): void {
    this.depth -= 1;
  }
}

function parseFormula(expression: string): AstNode {
  return new Parser(tokenize(expression)).parse();
}

const compiledExpressionCache = new Map<string, CompiledProgram>();

function compileExpression(expression: string): CompiledProgram {
  const raw = String(expression ?? '').trim();
  const cached = compiledExpressionCache.get(raw);
  if (cached) {
    compiledExpressionCache.delete(raw);
    compiledExpressionCache.set(raw, cached);
    return cached;
  }
  let program: CompiledProgram;
  try {
    program = { expression: raw, ast: parseFormula(raw) };
  } catch (error) {
    program = {
      expression: raw,
      ast: null,
      error: error instanceof TpsFormulaFailure
        ? error
        : new TpsFormulaFailure('syntax-error', error instanceof Error ? error.message : String(error)),
    };
  }
  compiledExpressionCache.set(raw, program);
  while (compiledExpressionCache.size > MAX_COMPILED_EXPRESSION_CACHE_ENTRIES) {
    const oldest = compiledExpressionCache.keys().next().value;
    if (oldest == null) break;
    compiledExpressionCache.delete(oldest);
  }
  return program;
}

function normalizeDefinitions(raw: unknown): TpsFormulaDefinitions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const definitions: TpsFormulaDefinitions = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = String(key || '').trim();
    if (!name || typeof value !== 'string') continue;
    definitions[name] = value;
  }
  return definitions;
}

export function extractTpsBaseFormulaDefinitions(parsed: unknown): TpsFormulaDefinitions {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return normalizeDefinitions((parsed as Record<string, unknown>).formulas);
}

export function hasTpsFormulaReference(value: unknown): boolean {
  const literalValueKeys = new Set([
    'value',
    'values',
    'expected',
    'right',
    'rhs',
    'target',
    'pattern',
    'match',
  ]);
  const seen = new WeakSet<object>();
  const stringHasReference = (candidate: string): boolean => {
    try {
      const tokens = tokenize(candidate);
      return tokens.some((token, index) => (
        token.type === 'identifier'
        && token.value.toLocaleLowerCase() === 'formula'
        && tokens[index + 1]?.type === 'punctuation'
        && (tokens[index + 1]?.value === '.' || tokens[index + 1]?.value === '[')
      ));
    } catch {
      // Invalid expressions must still take the formula-aware, fail-closed
      // route when they visibly reference the namespace. Valid quoted strings
      // and RegExp literals were already excluded by the tokenizer above.
      return /\bformula\s*(?:\.|\[)/iu.test(candidate);
    }
  };
  const visit = (candidate: unknown, depth: number, literal = false): boolean => {
    if (typeof candidate === 'string') return !literal && stringHasReference(candidate);
    if (!candidate || typeof candidate !== 'object' || depth > MAX_PARSE_DEPTH) return false;
    if (seen.has(candidate as object)) return false;
    seen.add(candidate as object);
    if (Array.isArray(candidate)) return candidate.some((item) => visit(item, depth + 1, literal));
    return Object.entries(candidate as Record<string, unknown>)
      .some(([key, item]) => (
        stringHasReference(key)
        || visit(item, depth + 1, literalValueKeys.has(key.trim().toLocaleLowerCase()))
      ));
  };
  return visit(value, 0);
}

function formulaRevision(definitions: TpsFormulaDefinitions): string {
  let hash = 0x811c9dc5;
  const update = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  };
  for (const key of Object.keys(definitions).sort()) {
    update(key);
    update('\u0000');
    update(definitions[key]);
    update('\u0001');
  }
  return `${Object.keys(definitions).length}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function definitionsEqual(left: Readonly<TpsFormulaDefinitions>, right: Readonly<TpsFormulaDefinitions>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => left[key] === right[key]);
}

function findKey(record: Record<string, unknown> | null | undefined, rawKey: unknown): string | null {
  if (!record) return null;
  const key = String(rawKey ?? '');
  if (Object.prototype.hasOwnProperty.call(record, key)) return key;
  const lower = key.toLocaleLowerCase();
  return Object.keys(record).find((candidate) => candidate.toLocaleLowerCase() === lower) ?? null;
}

function readRecordValue(record: Record<string, unknown> | null | undefined, key: unknown): unknown {
  const resolved = findKey(record, key);
  return resolved == null ? null : record![resolved];
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const local = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/u);
  if (local) {
    const date = new Date(
      Number(local[1]),
      Number(local[2]) - 1,
      Number(local[3]),
      Number(local[4] || 0),
      Number(local[5] || 0),
      Number(local[6] || 0),
      Number(String(local[7] || '0').padEnd(3, '0')),
    );
    if (
      date.getFullYear() === Number(local[1])
      && date.getMonth() === Number(local[2]) - 1
      && date.getDate() === Number(local[3])
    ) return date;
    return null;
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function emptyDuration(): TpsDurationValue {
  return Object.freeze({
    __tpsFormulaType: 'duration',
    years: 0,
    months: 0,
    weeks: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    milliseconds: 0,
  });
}

function parseDuration(value: unknown): TpsDurationValue | null {
  if (isDuration(value)) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const duration = { ...emptyDuration() } as { -readonly [K in keyof TpsDurationValue]: TpsDurationValue[K] };
  const pattern = /([+-]?\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|M|weeks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s|milliseconds?|msecs?|ms)/gu;
  let matched = '';
  for (const match of raw.matchAll(pattern)) {
    matched += match[0];
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount)) return null;
    if (/^(?:years?|yrs?|y)$/u.test(unit)) duration.years += amount;
    else if (/^(?:months?|mos?|M)$/u.test(unit)) duration.months += amount;
    else if (/^(?:weeks?|w)$/u.test(unit)) duration.weeks += amount;
    else if (/^(?:days?|d)$/u.test(unit)) duration.days += amount;
    else if (/^(?:hours?|hrs?|h)$/u.test(unit)) duration.hours += amount;
    else if (/^(?:minutes?|mins?|m)$/u.test(unit)) duration.minutes += amount;
    else if (/^(?:seconds?|secs?|s)$/u.test(unit)) duration.seconds += amount;
    else duration.milliseconds += amount;
  }
  const remainder = raw.replace(pattern, '').replace(/[\s,]+/gu, '');
  if (!matched || remainder) return null;
  return Object.freeze(duration);
}

function isDuration(value: unknown): value is TpsDurationValue {
  return !!value && typeof value === 'object' && (value as TpsDurationValue).__tpsFormulaType === 'duration';
}

function isLink(value: unknown): value is TpsFormulaLinkValue {
  return !!value && typeof value === 'object' && (value as TpsFormulaLinkValue).__tpsFormulaType === 'link';
}

function isRuntimeFile(value: unknown): value is TpsRuntimeFileValue {
  return !!value && typeof value === 'object' && (value as TpsRuntimeFileValue).__tpsFormulaType === 'file';
}

function isFormulaNamespace(value: unknown): value is FormulaNamespace {
  return value === FORMULA_NAMESPACE;
}

function readPublicBasesValueText(value: object, constructorType: string): string {
  if (typeof (value as any).toString !== 'function') {
    throw new TpsFormulaFailure(
      'incompatible-native-value',
      `Native Bases ${constructorType} value does not expose the public toString() contract`,
      true,
    );
  }
  try {
    return boundedRuntimeString(String((value as any).toString()));
  } catch (error) {
    if (error instanceof TpsFormulaFailure) throw error;
    throw new TpsFormulaFailure(
      'native-value-read-failed',
      `Native Bases ${constructorType} value could not be read through toString()`,
      true,
    );
  }
}

function parsePublicBasesRegExp(text: string): RegExp {
  if (!text.startsWith('/')) {
    throw new TpsFormulaFailure(
      'invalid-native-regexp',
      'Native Bases RegExp value did not provide /pattern/flags text',
      true,
    );
  }
  let closingSlash = -1;
  for (let index = text.length - 1; index > 0; index -= 1) {
    if (text[index] !== '/') continue;
    let escapes = 0;
    for (let previous = index - 1; previous >= 0 && text[previous] === '\\'; previous -= 1) escapes += 1;
    if (escapes % 2 === 0) {
      closingSlash = index;
      break;
    }
  }
  if (closingSlash <= 0) {
    throw new TpsFormulaFailure(
      'invalid-native-regexp',
      'Native Bases RegExp value did not provide a closing slash',
      true,
    );
  }
  const source = text.slice(1, closingSlash);
  const flags = text.slice(closingSlash + 1);
  if (!/^[dgimsuvy]*$/u.test(flags) || new Set(flags).size !== flags.length) {
    throw new TpsFormulaFailure('invalid-native-regexp', 'Native Bases RegExp value has invalid flags', true);
  }
  assertSafeRegExpSource(source);
  try {
    return new RegExp(source, flags);
  } catch (error) {
    throw new TpsFormulaFailure(
      'invalid-native-regexp',
      error instanceof Error ? error.message : 'Native Bases RegExp value is invalid',
      true,
    );
  }
}

/**
 * Native BasesEntry values are public Obsidian Value objects, while TPS
 * synthetic formulas use plain JavaScript values. Normalize the public,
 * documented Value surface so shared sort/group/format adapters compare both
 * row kinds consistently without reading private wrapper fields.
 */
function normalizePublicBasesValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (
    !value
    || typeof value !== 'object'
    || value instanceof Date
    || value instanceof RegExp
    || Array.isArray(value)
    || isDuration(value)
    || isLink(value)
    || isRuntimeFile(value)
  ) return value;

  const constructorType = String((value as any)?.constructor?.type || '').trim().toLocaleLowerCase();
  if (!constructorType) return value;
  if (constructorType === 'null') return null;
  if (constructorType === 'boolean') {
    if (typeof (value as any).isTruthy !== 'function') {
      throw new TpsFormulaFailure(
        'incompatible-native-value',
        'Native Bases boolean value does not expose the public isTruthy() contract',
        true,
      );
    }
    try {
      return Boolean((value as any).isTruthy());
    } catch {
      throw new TpsFormulaFailure(
        'native-value-read-failed',
        'Native Bases boolean value could not be read through isTruthy()',
        true,
      );
    }
  }
  if (constructorType === 'list') {
    if (typeof (value as any).length !== 'function' || typeof (value as any).get !== 'function') {
      throw new TpsFormulaFailure(
        'incompatible-native-value',
        'Native Bases list value does not expose the public length()/get() contract',
        true,
      );
    }
    try {
      if (depth > MAX_PARSE_DEPTH) {
        throw new TpsFormulaFailure('output-too-deep', `Native Bases list exceeds ${MAX_PARSE_DEPTH} levels`);
      }
      if (seen.has(value as object)) {
        throw new TpsFormulaFailure('cyclic-output', 'Native Bases list contains a cyclic value');
      }
      const length = Number((value as any).length());
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new TpsFormulaFailure('invalid-native-value', 'Native Bases list length is not a non-negative integer', true);
      }
      if (length > MAX_COLLECTION_ITERATIONS) {
        throw new TpsFormulaFailure('collection-too-large', `Native Bases list exceeds ${MAX_COLLECTION_ITERATIONS} items`);
      }
      seen.add(value as object);
      const items = Array.from({ length }, (_unused, index) =>
        normalizePublicBasesValue((value as any).get(index), seen, depth + 1));
      seen.delete(value as object);
      return items;
    } catch (error) {
      seen.delete(value as object);
      if (error instanceof TpsFormulaFailure) throw error;
      throw new TpsFormulaFailure(
        'native-value-read-failed',
        'Native Bases list value could not be read through length()/get()',
        true,
      );
    }
  }

  const text = readPublicBasesValueText(value as object, constructorType);
  if (constructorType === 'number') {
    const number = Number(text);
    if (!Number.isFinite(number)) {
      throw new TpsFormulaFailure('invalid-native-value', 'Native Bases number value is not finite', true);
    }
    return number;
  }
  if (constructorType === 'date' || constructorType === 'relative-date') {
    const date = toDate(text);
    if (!date) {
      throw new TpsFormulaFailure('invalid-native-value', `Native Bases ${constructorType} value is not a valid date`, true);
    }
    return date;
  }
  if (constructorType === 'duration') {
    if (typeof (value as any).getMilliseconds === 'function') {
      let milliseconds: number;
      try {
        milliseconds = Number((value as any).getMilliseconds());
      } catch {
        throw new TpsFormulaFailure(
          'native-value-read-failed',
          'Native Bases duration value could not be read through getMilliseconds()',
          true,
        );
      }
      if (Number.isFinite(milliseconds)) {
        return Object.freeze({ ...emptyDuration(), milliseconds }) as TpsDurationValue;
      }
    }
    const duration = parseDuration(text);
    if (!duration) {
      throw new TpsFormulaFailure('invalid-native-value', 'Native Bases duration value is not valid', true);
    }
    return duration;
  }
  if (constructorType === 'link') {
    const match = text.trim().match(/^!?\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/u);
    const path = String(match?.[1] ?? text).trim();
    if (!path) throw new TpsFormulaFailure('invalid-native-value', 'Native Bases link value has no target', true);
    return Object.freeze({
      __tpsFormulaType: 'link',
      path,
      ...(match?.[2] ? { display: match[2].trim() } : {}),
    }) as TpsFormulaLinkValue;
  }
  if (constructorType === 'file') {
    const file = fileValue({ path: text.trim() });
    if (!file) throw new TpsFormulaFailure('invalid-native-value', 'Native Bases file value has no path', true);
    return file;
  }
  if (constructorType === 'regexp' || constructorType === 'regex') {
    return parsePublicBasesRegExp(text);
  }
  if (constructorType === 'object') {
    if (text === '[object Object]') {
      throw new TpsFormulaFailure(
        'unsupported-native-value',
        'Native Bases object value cannot be canonicalized without a public textual representation',
        true,
      );
    }
    return text;
  }
  if (['string', 'tag', 'url', 'html', 'icon', 'image'].includes(constructorType)) return text;
  throw new TpsFormulaFailure(
    'unsupported-native-value',
    `Native Bases value type ${constructorType} is not supported by the Formula API v1 adapters`,
    true,
  );
}

function durationToMilliseconds(duration: TpsDurationValue): number {
  return duration.milliseconds
    + duration.seconds * 1_000
    + duration.minutes * 60_000
    + duration.hours * 3_600_000
    + (duration.days + duration.weeks * 7) * 86_400_000
    + duration.months * 30 * 86_400_000
    + duration.years * 365 * 86_400_000;
}

function scaleDuration(duration: TpsDurationValue, scalar: number): TpsDurationValue {
  if (!Number.isFinite(scalar)) throw new TpsFormulaFailure('invalid-number', 'Duration scalar must be finite');
  return Object.freeze({
    __tpsFormulaType: 'duration',
    years: duration.years * scalar,
    months: duration.months * scalar,
    weeks: duration.weeks * scalar,
    days: duration.days * scalar,
    hours: duration.hours * scalar,
    minutes: duration.minutes * scalar,
    seconds: duration.seconds * scalar,
    milliseconds: duration.milliseconds * scalar,
  });
}

function addDurationToDate(dateValue: Date, duration: TpsDurationValue, direction = 1): Date {
  const date = new Date(dateValue.getTime());
  const calendarMonths = direction * (duration.years * 12 + duration.months);
  if (calendarMonths) {
    if (!Number.isInteger(calendarMonths)) {
      throw new TpsFormulaFailure('fractional-calendar-duration', 'Year and month date arithmetic requires whole calendar units');
    }
    const originalDay = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + calendarMonths);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(originalDay, lastDay));
  }
  // Bases treats day/week duration units as fixed elapsed time (for example,
  // `now() + "1 day"` is exactly 24 hours), rather than as `setDate()` local
  // calendar arithmetic. Years and months remain calendar-aware above.
  const millis = duration.milliseconds
    + duration.seconds * 1_000
    + duration.minutes * 60_000
    + duration.hours * 3_600_000
    + (duration.days + duration.weeks * 7) * 86_400_000;
  if (millis) date.setTime(date.getTime() + direction * millis);
  return date;
}

function typeName(value: unknown): string {
  if (value == null) return 'null';
  if (value instanceof Date) return 'date';
  if (Array.isArray(value)) return 'list';
  if (value instanceof RegExp) return 'regexp';
  if (isDuration(value)) return 'duration';
  if (isLink(value)) return 'link';
  if (isRuntimeFile(value)) return 'file';
  return typeof value === 'object' ? 'object' : typeof value;
}

function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Date || value instanceof RegExp || isDuration(value) || isLink(value) || isRuntimeFile(value)) return false;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function assertRuntimeValueBounds(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0,
  budget = { items: 0, characters: 0 },
): void {
  if (typeof value === 'string') {
    budget.characters += value.length;
    if (budget.characters > MAX_RUNTIME_STRING_LENGTH) {
      throw new TpsFormulaFailure(
        'output-too-large',
        `Formula output exceeds ${MAX_RUNTIME_STRING_LENGTH} characters`,
      );
    }
    return;
  }
  if (
    value == null
    || typeof value !== 'object'
    || value instanceof Date
    || value instanceof RegExp
    || isDuration(value)
    || isLink(value)
    || isRuntimeFile(value)
  ) return;
  if (depth > MAX_PARSE_DEPTH) {
    throw new TpsFormulaFailure('output-too-deep', `Formula output exceeds ${MAX_PARSE_DEPTH} levels`);
  }
  if (seen.has(value as object)) {
    throw new TpsFormulaFailure('cyclic-output', 'Formula output contains a cyclic value');
  }
  seen.add(value as object);
  const values = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>);
  budget.items += values.length;
  if (budget.items > MAX_COLLECTION_ITERATIONS) {
    throw new TpsFormulaFailure(
      'collection-too-large',
      `Formula output exceeds ${MAX_COLLECTION_ITERATIONS} items`,
    );
  }
  for (const item of values) assertRuntimeValueBounds(item, seen, depth + 1, budget);
  seen.delete(value as object);
}

function boundedRuntimeString(value: string): string {
  if (value.length > MAX_RUNTIME_STRING_LENGTH) {
    throw new TpsFormulaFailure(
      'output-too-large',
      `Formula output exceeds ${MAX_RUNTIME_STRING_LENGTH} characters`,
    );
  }
  return value;
}

function isTruthy(value: unknown): boolean {
  return Boolean(value);
}

export function isTpsFormulaTruthy(value: unknown): boolean {
  if (
    value
    && typeof value === 'object'
    && String((value as any)?.constructor?.type || '').trim()
    && typeof (value as any).isTruthy === 'function'
  ) {
    try {
      return Boolean((value as any).isTruthy());
    } catch {
      throw new TpsFormulaFailure(
        'native-value-read-failed',
        'Native Bases value could not be read through isTruthy()',
        true,
      );
    }
  }
  return isTruthy(normalizePublicBasesValue(value));
}

function normalizeLinkPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^\[\[|\]\]$/gu, '')
    .split('|')[0]
    .replace(/\.md$/iu, '')
    .replace(/\\/gu, '/')
    .toLocaleLowerCase();
}

function getComparablePath(value: unknown): unknown {
  if (isLink(value) || isRuntimeFile(value)) return value.path;
  if (value && typeof value === 'object') {
    const file = readRecordValue(value as Record<string, unknown>, 'file');
    if (isLink(file) || isRuntimeFile(file)) return file.path;
    if (file && typeof file === 'object') {
      const path = readRecordValue(file as Record<string, unknown>, 'path');
      if (path != null) return path;
    }
  }
  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return left == null && right == null;
  if (left instanceof Date || right instanceof Date) {
    const leftDate = toDate(left);
    const rightDate = toDate(right);
    return !!leftDate && !!rightDate && leftDate.getTime() === rightDate.getTime();
  }
  if (isLink(left) || isLink(right)) {
    const leftPath = getComparablePath(left);
    const rightPath = getComparablePath(right);
    return normalizeLinkPath(leftPath) === normalizeLinkPath(rightPath);
  }
  if (isRuntimeFile(left) || isRuntimeFile(right)) {
    const leftPath = isRuntimeFile(left) ? left.path : left;
    const rightPath = isRuntimeFile(right) ? right.path : right;
    return normalizeLinkPath(leftPath) === normalizeLinkPath(rightPath);
  }
  if (isDuration(left) || isDuration(right)) {
    return isDuration(left) && isDuration(right) && durationToMilliseconds(left) === durationToMilliseconds(right);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (typeof left === 'number' && typeof right === 'number') return Object.is(left, right) || left === right;
  return left === right;
}

function compareValues(left: unknown, right: unknown): number {
  if (valuesEqual(left, right)) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  const leftDate = left instanceof Date ? left : null;
  const rightDate = right instanceof Date ? right : null;
  if (leftDate && rightDate) return leftDate.getTime() < rightDate.getTime() ? -1 : 1;
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1;
  const leftText = formatTpsFormulaValue(left);
  const rightText = formatTpsFormulaValue(right);
  return leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: 'base' });
}

function arithmetic(operator: string, left: unknown, right: unknown): unknown {
  if (operator === '+') {
    const leftDate = left instanceof Date ? left : null;
    const rightDate = right instanceof Date ? right : null;
    const rightDuration = isDuration(right) ? right : leftDate ? parseDuration(right) : null;
    const leftDuration = isDuration(left) ? left : rightDate ? parseDuration(left) : null;
    if (leftDate && rightDuration) return addDurationToDate(leftDate, rightDuration);
    if (rightDate && leftDuration) return addDurationToDate(rightDate, leftDuration);
    if (isDuration(left) && isDuration(right)) {
      return Object.freeze({
        __tpsFormulaType: 'duration',
        years: left.years + right.years,
        months: left.months + right.months,
        weeks: left.weeks + right.weeks,
        days: left.days + right.days,
        hours: left.hours + right.hours,
        minutes: left.minutes + right.minutes,
        seconds: left.seconds + right.seconds,
        milliseconds: left.milliseconds + right.milliseconds,
      });
    }
    if (typeof left === 'string' || typeof right === 'string') {
      return boundedRuntimeString(`${formatTpsFormulaValue(left)}${formatTpsFormulaValue(right)}`);
    }
    const result = Number(left) + Number(right);
    if (!Number.isFinite(result)) throw new TpsFormulaFailure('invalid-arithmetic', 'Addition requires numbers, text, dates, or durations');
    return result;
  }
  if (operator === '-') {
    // Bases documents date subtraction as a numeric millisecond difference.
    if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
    const duration = isDuration(right) ? right : left instanceof Date ? parseDuration(right) : null;
    if (left instanceof Date && duration) return addDurationToDate(left, duration, -1);
    if (isDuration(left) && isDuration(right)) return arithmetic('+', left, scaleDuration(right, -1));
    const result = Number(left) - Number(right);
    if (!Number.isFinite(result)) throw new TpsFormulaFailure('invalid-arithmetic', 'Subtraction requires numbers, dates, or durations');
    return result;
  }
  if (operator === '*') {
    if (isDuration(left)) return scaleDuration(left, Number(right));
    const result = Number(left) * Number(right);
    if (!Number.isFinite(result)) throw new TpsFormulaFailure('invalid-arithmetic', 'Multiplication requires numbers or a duration on the left');
    return result;
  }
  if (operator === '/') {
    const divisor = Number(right);
    if (!Number.isFinite(divisor) || divisor === 0) throw new TpsFormulaFailure('divide-by-zero', 'Division requires a non-zero number');
    if (isDuration(left)) return scaleDuration(left, 1 / divisor);
    const result = Number(left) / divisor;
    if (!Number.isFinite(result)) throw new TpsFormulaFailure('invalid-arithmetic', 'Division requires numbers or a duration on the left');
    return result;
  }
  if (operator === '%') {
    const divisor = Number(right);
    if (!Number.isFinite(divisor) || divisor === 0) throw new TpsFormulaFailure('divide-by-zero', 'Modulo requires a non-zero number');
    const result = Number(left) % divisor;
    if (!Number.isFinite(result)) throw new TpsFormulaFailure('invalid-arithmetic', 'Modulo requires numbers');
    return result;
  }
  throw new TpsFormulaFailure('unsupported-operator', `Unsupported operator ${operator}`, true);
}

function pad(value: number, size = 2): string {
  return String(Math.trunc(Math.abs(value))).padStart(size, '0');
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = MONTH_NAMES.map((value) => value.slice(0, 3));
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = DAY_NAMES.map((value) => value.slice(0, 3));

function formatDate(date: Date, pattern: string): string {
  const hour12 = date.getHours() % 12 || 12;
  const replacements: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: MONTH_NAMES[date.getMonth()],
    MMM: MONTH_SHORT[date.getMonth()],
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    dddd: DAY_NAMES[date.getDay()],
    ddd: DAY_SHORT[date.getDay()],
    HH: pad(date.getHours()),
    H: String(date.getHours()),
    hh: pad(hour12),
    h: String(hour12),
    mm: pad(date.getMinutes()),
    m: String(date.getMinutes()),
    ss: pad(date.getSeconds()),
    s: String(date.getSeconds()),
    SSS: pad(date.getMilliseconds(), 3),
    A: date.getHours() >= 12 ? 'PM' : 'AM',
    a: date.getHours() >= 12 ? 'pm' : 'am',
  };
  return String(pattern || '').replace(/\[[^\]]*\]|YYYY|MMMM|dddd|MMM|ddd|SSS|YY|MM|DD|HH|hh|mm|ss|M|D|H|h|m|s|A|a/gu, (token) => (
    token.startsWith('[') ? token.slice(1, -1) : replacements[token] ?? token
  ));
}

function relativeDate(date: Date, now: Date): string {
  const milliseconds = date.getTime() - now.getTime();
  const absolute = Math.abs(milliseconds);
  const units: Array<[number, string]> = [
    [365 * 86_400_000, 'year'],
    [30 * 86_400_000, 'month'],
    [7 * 86_400_000, 'week'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1_000, 'second'],
  ];
  const [size, label] = units.find(([unit]) => absolute >= unit) ?? [1_000, 'second'];
  const count = Math.max(0, Math.round(absolute / size));
  return milliseconds < 0 ? `${count} ${label}${count === 1 ? '' : 's'} ago` : `in ${count} ${label}${count === 1 ? '' : 's'}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/gu, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]!));
}

function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function flattenList(values: unknown[]): unknown[] {
  const output: unknown[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > MAX_PARSE_DEPTH) throw new TpsFormulaFailure('collection-too-deep', `List nesting exceeds ${MAX_PARSE_DEPTH} levels`);
    if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
    else {
      output.push(value);
      if (output.length > MAX_COLLECTION_ITERATIONS) {
        throw new TpsFormulaFailure('collection-too-large', `List exceeds ${MAX_COLLECTION_ITERATIONS} items`);
      }
    }
  };
  values.forEach((value) => visit(value, 0));
  return output;
}

function uniqueList(values: unknown[]): unknown[] {
  if (values.length > MAX_COLLECTION_ITERATIONS) {
    throw new TpsFormulaFailure('collection-too-large', `unique() exceeds ${MAX_COLLECTION_ITERATIONS} items`);
  }
  // Frontmatter/tag lists overwhelmingly contain primitives. Use native Set
  // identity for that exact-equality case so 10,000 unique values stay O(n),
  // while retaining the typed/deep comparator for mixed structured values.
  if (values.every((value) => value == null || !['object', 'function'].includes(typeof value))) {
    return Array.from(new Set(values));
  }
  const output: unknown[] = [];
  for (const value of values) if (!output.some((candidate) => valuesEqual(candidate, value))) output.push(value);
  return output;
}

function fileValue(raw: TpsFormulaFileContext | null | undefined): TpsRuntimeFileValue | null {
  if (!raw) return null;
  const extension = String(raw.extension ?? raw.ext ?? '').replace(/^\./u, '');
  const name = String(raw.name ?? raw.path.split('/').at(-1) ?? '');
  const basename = String(raw.basename ?? name.replace(/\.[^.]+$/u, ''));
  const folder = String(raw.folder ?? (raw.path.includes('/') ? raw.path.slice(0, raw.path.lastIndexOf('/')) : ''));
  return Object.freeze({
    ...raw,
    __tpsFormulaType: 'file',
    path: String(raw.path || ''),
    name,
    basename,
    extension,
    ext: extension,
    folder,
    size: Number(raw.size ?? 0),
    ctime: toDate(raw.ctime) ?? null,
    mtime: toDate(raw.mtime) ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    links: Array.isArray(raw.links) ? raw.links : [],
    properties: raw.properties && typeof raw.properties === 'object' ? raw.properties : {},
  });
}

function contextObject(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const file = value.file && typeof value.file === 'object'
    ? fileValue(value.file as TpsFormulaFileContext)
    : value.file;
  return file === value.file ? value : { ...value, file };
}

function normalizeFormulaName(rawName: unknown): string {
  return String(rawName ?? '').trim().replace(/^formula\./iu, '');
}

function errorResult(formula: string, error: unknown): TpsFormulaResult {
  const failure = error instanceof TpsFormulaFailure
    ? error
    : new TpsFormulaFailure('evaluation-error', error instanceof Error ? error.message : String(error || 'Formula evaluation failed'));
  return {
    status: failure.unsupported ? 'unsupported' : 'error',
    value: null,
    formula,
    code: failure.code,
    message: failure.message,
  };
}

export class TpsFormulaRowSession {
  private readonly memo = new Map<string, TpsFormulaResult>();
  private readonly resolving: string[] = [];
  private readonly nowValue: Date;
  private readonly runtimeFile: TpsRuntimeFileValue | null;
  private readonly runtimeThis: Record<string, unknown> | null;

  constructor(
    readonly compiled: TpsCompiledFormulaSet,
    readonly context: TpsFormulaRecordContext,
  ) {
    this.nowValue = toDate(context.now) ?? new Date();
    this.runtimeFile = fileValue(context.file);
    this.runtimeThis = contextObject(context.thisValue);
  }

  get(rawName: string): TpsFormulaResult {
    const requested = normalizeFormulaName(rawName);
    const exact = this.compiled.programs.has(requested)
      ? requested
      : this.compiled.namesByLowerCase.get(requested.toLocaleLowerCase());
    const formula = exact ?? requested;
    if (!formula || !this.compiled.programs.has(formula)) {
      return errorResult(formula, new TpsFormulaFailure('unknown-formula', `Formula ${JSON.stringify(formula)} is not declared`));
    }
    const cached = this.memo.get(formula);
    if (cached) return cached;
    if (this.resolving.includes(formula)) {
      const cycle = [...this.resolving.slice(this.resolving.indexOf(formula)), formula].join(' -> ');
      const result = errorResult(formula, new TpsFormulaFailure('formula-cycle', `Circular formula reference: ${cycle}`));
      this.memo.set(formula, result);
      return result;
    }
    if (this.resolving.length >= MAX_DEPENDENCY_DEPTH) {
      const result = errorResult(formula, new TpsFormulaFailure('dependency-too-deep', `Formula dependency depth exceeds ${MAX_DEPENDENCY_DEPTH}`));
      this.memo.set(formula, result);
      return result;
    }
    const program = this.compiled.programs.get(formula)!;
    if (program.error || !program.ast) {
      const result = errorResult(formula, program.error ?? new TpsFormulaFailure('syntax-error', 'Formula could not be parsed'));
      this.memo.set(formula, result);
      return result;
    }
    this.resolving.push(formula);
    try {
      const value = this.evaluateNode(program.ast, {});
      assertRuntimeValueBounds(value);
      const result: TpsFormulaResult = {
        status: isEmpty(value) ? 'empty' : 'value',
        value: value ?? null,
        formula,
      };
      this.memo.set(formula, result);
      return result;
    } catch (error) {
      const result = errorResult(formula, error);
      this.memo.set(formula, result);
      return result;
    } finally {
      this.resolving.pop();
    }
  }

  getAll(): Record<string, TpsFormulaResult> {
    return Object.fromEntries(Array.from(this.compiled.programs.keys()).map((name) => [name, this.get(name)]));
  }

  getValue(rawName: string): unknown {
    const result = this.get(rawName);
    return result.status === 'value' || result.status === 'empty' ? result.value : null;
  }

  evaluateExpression(expression: string, label = '$expression'): TpsFormulaResult {
    const program = compileExpression(expression);
    if (program.error || !program.ast) {
      return errorResult(label, program.error ?? new TpsFormulaFailure('syntax-error', 'Expression could not be parsed'));
    }
    try {
      const value = this.evaluateNode(program.ast, {});
      assertRuntimeValueBounds(value);
      return {
        status: isEmpty(value) ? 'empty' : 'value',
        value: value ?? null,
        formula: label,
      };
    } catch (error) {
      return errorResult(label, error);
    }
  }

  private evaluateNode(node: AstNode, scope: EvaluationScope): unknown {
    switch (node.type) {
      case 'literal': return node.value;
      case 'identifier': return this.resolveIdentifier(node.name, scope);
      case 'array': return node.elements.map((element) => this.evaluateNode(element, scope));
      case 'object': return Object.fromEntries(node.entries.map((entry) => [entry.key, this.evaluateNode(entry.value, scope)]));
      case 'unary': {
        const value = this.evaluateNode(node.argument, scope);
        if (node.operator === '!') return !isTruthy(value);
        if (node.operator === '+') {
          const number = Number(value);
          if (!Number.isFinite(number)) throw new TpsFormulaFailure('invalid-number', 'Unary + requires a number');
          return number;
        }
        if (node.operator === '-') {
          const number = Number(value);
          if (!Number.isFinite(number)) throw new TpsFormulaFailure('invalid-number', 'Unary - requires a number');
          return -number;
        }
        throw new TpsFormulaFailure('unsupported-operator', `Unsupported unary operator ${node.operator}`, true);
      }
      case 'binary': return this.evaluateBinary(node, scope);
      case 'conditional': return isTruthy(this.evaluateNode(node.test, scope))
        ? this.evaluateNode(node.consequent, scope)
        : this.evaluateNode(node.alternate, scope);
      case 'member': {
        const object = this.evaluateNode(node.object, scope);
        const property = this.evaluateNode(node.property, scope);
        return this.readMember(object, property);
      }
      case 'call': return this.evaluateCall(node, scope);
      default: throw new TpsFormulaFailure('invalid-ast', 'Unknown formula node');
    }
  }

  private evaluateBinary(node: BinaryNode, scope: EvaluationScope): unknown {
    if (node.operator === '&&') {
      const left = this.evaluateNode(node.left, scope);
      return isTruthy(left) ? this.evaluateNode(node.right, scope) : left;
    }
    if (node.operator === '||') {
      const left = this.evaluateNode(node.left, scope);
      return isTruthy(left) ? left : this.evaluateNode(node.right, scope);
    }
    const left = this.evaluateNode(node.left, scope);
    const right = this.evaluateNode(node.right, scope);
    if (['+', '-', '*', '/', '%'].includes(node.operator)) return arithmetic(node.operator, left, right);
    if (node.operator === '==' || node.operator === '===') return valuesEqual(left, right);
    if (node.operator === '!=' || node.operator === '!==') return !valuesEqual(left, right);
    const comparison = compareValues(left, right);
    if (node.operator === '<') return comparison < 0;
    if (node.operator === '<=') return comparison <= 0;
    if (node.operator === '>') return comparison > 0;
    if (node.operator === '>=') return comparison >= 0;
    throw new TpsFormulaFailure('unsupported-operator', `Unsupported operator ${node.operator}`, true);
  }

  private resolveIdentifier(name: string, scope: EvaluationScope): unknown {
    const scopeKey = findKey(scope, name);
    if (scopeKey != null) return scope[scopeKey];
    const lower = name.toLocaleLowerCase();
    if (lower === 'formula') return FORMULA_NAMESPACE;
    if (lower === 'row') return this.context.row ?? {};
    if (lower === 'note') return this.context.note ?? {};
    if (lower === 'file') return this.runtimeFile;
    if (lower === 'this') return this.runtimeThis;
    if (lower === 'task') return this.context.task ?? null;
    if (lower === 'line') return this.context.line ?? null;
    if (lower === 'heading') return this.context.heading ?? null;
    if (lower === 'external') return this.context.external ?? null;
    const rowKey = findKey(this.context.row, name);
    if (rowKey != null) return this.context.row![rowKey];
    const noteKey = findKey(this.context.note, name);
    if (noteKey != null) return this.context.note![noteKey];
    return null;
  }

  private readMember(object: unknown, rawProperty: unknown): unknown {
    const property = String(rawProperty ?? '');
    if (isFormulaNamespace(object)) {
      const result = this.get(property);
      if (result.status === 'error' || result.status === 'unsupported') {
        throw new TpsFormulaFailure(result.code || 'formula-error', result.message || `Formula ${property} failed`, result.status === 'unsupported');
      }
      return result.value;
    }
    if (object == null) return null;
    if (isRuntimeFile(object)) {
      const normalizedProperty = property.toLocaleLowerCase();
      if (normalizedProperty === 'file') return object;
      if (normalizedProperty === 'backlinks' || normalizedProperty === 'embeds') {
        throw new TpsFormulaFailure(
          'unsupported-file-index',
          `file.${property} requires a vault-wide index that is unavailable for synthetic rows`,
          true,
        );
      }
    }
    if (Array.isArray(object) || typeof object === 'string') {
      if (property === 'length') return object.length;
      const index = Number(property);
      if (Number.isInteger(index)) return object[index] ?? null;
    }
    if (object instanceof Date) {
      if (property === 'year') return object.getFullYear();
      if (property === 'month') return object.getMonth() + 1;
      if (property === 'day') return object.getDate();
      if (property === 'hour') return object.getHours();
      if (property === 'minute') return object.getMinutes();
      if (property === 'second') return object.getSeconds();
      if (property === 'millisecond') return object.getMilliseconds();
    }
    if (typeof object === 'object') return readRecordValue(object as Record<string, unknown>, property);
    return null;
  }

  private evaluateCall(node: CallNode, scope: EvaluationScope): unknown {
    if (node.callee.type === 'identifier') return this.callGlobal(node.callee.name, node.args, scope);
    if (node.callee.type !== 'member') throw new TpsFormulaFailure('invalid-call', 'Formula calls must target a named function');
    const receiver = this.evaluateNode(node.callee.object, scope);
    const method = String(this.evaluateNode(node.callee.property, scope) ?? '');
    return this.callMethod(receiver, method, node.args, scope);
  }

  private callGlobal(rawName: string, args: AstNode[], scope: EvaluationScope): unknown {
    const name = rawName.toLocaleLowerCase();
    if (name === 'if') {
      if (args.length < 2 || args.length > 3) throw new TpsFormulaFailure('wrong-argument-count', 'if() expects two or three arguments');
      return isTruthy(this.evaluateNode(args[0], scope))
        ? this.evaluateNode(args[1], scope)
        : args[2] ? this.evaluateNode(args[2], scope) : null;
    }
    if (name === 'now' || name === 'today') {
      if (args.length) throw new TpsFormulaFailure('wrong-argument-count', `${rawName}() expects no arguments`);
      const value = new Date(this.nowValue.getTime());
      if (name === 'today') value.setHours(0, 0, 0, 0);
      return value;
    }
    const values = args.map((argument) => this.evaluateNode(argument, scope));
    if (name === 'date') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'date() expects one argument');
      const date = toDate(values[0]);
      if (!date) throw new TpsFormulaFailure('invalid-date', `Could not parse date ${JSON.stringify(values[0])}`);
      return date;
    }
    if (name === 'duration') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'duration() expects one argument');
      const duration = parseDuration(values[0]);
      if (!duration) throw new TpsFormulaFailure('invalid-duration', `Could not parse duration ${JSON.stringify(values[0])}`);
      return duration;
    }
    if (name === 'number') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'number() expects one argument');
      const number = values[0] instanceof Date ? values[0].getTime() : Number(values[0]);
      if (!Number.isFinite(number)) throw new TpsFormulaFailure('invalid-number', `Could not convert ${JSON.stringify(values[0])} to a number`);
      return number;
    }
    if (name === 'list') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'list() expects one argument');
      return Array.isArray(values[0]) ? values[0] : [values[0]];
    }
    if (name === 'min' || name === 'max') {
      if (!values.length) throw new TpsFormulaFailure('wrong-argument-count', `${rawName}() expects at least one argument`);
      const numbers = values.map(Number);
      if (numbers.some((value) => !Number.isFinite(value))) throw new TpsFormulaFailure('invalid-number', `${rawName}() accepts only numbers`);
      return name === 'min' ? Math.min(...numbers) : Math.max(...numbers);
    }
    if (name === 'link') {
      if (values.length < 1 || values.length > 2) throw new TpsFormulaFailure('wrong-argument-count', 'link() expects one or two arguments');
      const path = isRuntimeFile(values[0]) ? values[0].path : isLink(values[0]) ? values[0].path : String(values[0] ?? '');
      return Object.freeze({ __tpsFormulaType: 'link', path, ...(values.length > 1 ? { display: values[1] } : {}) }) as TpsFormulaLinkValue;
    }
    if (name === 'escapehtml') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'escapeHTML() expects one argument');
      return boundedRuntimeString(escapeHtml(values[0]));
    }
    if (['random', 'file', 'html', 'image', 'icon'].includes(name)) {
      throw new TpsFormulaFailure('unsupported-function', `${rawName}() is intentionally unsupported for deterministic synthetic rows`, true);
    }
    throw new TpsFormulaFailure('unknown-function', `Unknown formula function ${rawName}()`, true);
  }

  private callMethod(receiver: unknown, rawMethod: string, args: AstNode[], scope: EvaluationScope): unknown {
    const method = rawMethod.toLocaleLowerCase();
    if (Array.isArray(receiver) && ['filter', 'map', 'reduce'].includes(method)) {
      if (!args.length || (method !== 'reduce' && args.length !== 1) || (method === 'reduce' && args.length !== 2)) {
        throw new TpsFormulaFailure('wrong-argument-count', `${rawMethod}() received the wrong number of arguments`);
      }
      if (receiver.length > MAX_COLLECTION_ITERATIONS) {
        throw new TpsFormulaFailure('collection-too-large', `${rawMethod}() exceeds ${MAX_COLLECTION_ITERATIONS} items`);
      }
      if (method === 'filter') return receiver.filter((value, index) => isTruthy(this.evaluateNode(args[0], { ...scope, value, index })));
      if (method === 'map') return receiver.map((value, index) => this.evaluateNode(args[0], { ...scope, value, index }));
      let acc = this.evaluateNode(args[1], scope);
      receiver.forEach((value, index) => {
        acc = this.evaluateNode(args[0], { ...scope, value, index, acc });
      });
      return acc;
    }
    if (method === 'istruthy') {
      if (args.length) throw new TpsFormulaFailure('wrong-argument-count', 'isTruthy() expects no arguments');
      return isTruthy(receiver);
    }
    if (method === 'isempty' || method === 'empty' || method === 'isnotempty' || method === 'exists') {
      if (args.length) throw new TpsFormulaFailure('wrong-argument-count', `${rawMethod}() expects no arguments`);
      return method === 'isempty' || method === 'empty' ? isEmpty(receiver) : !isEmpty(receiver);
    }
    const values = args.map((argument) => this.evaluateNode(argument, scope));
    if (method === 'istype') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'isType() expects one argument');
      return typeName(receiver) === String(values[0] ?? '').toLocaleLowerCase();
    }
    if (method === 'tostring') {
      if (values.length) throw new TpsFormulaFailure('wrong-argument-count', 'toString() expects no arguments');
      return formatTpsFormulaValue(receiver);
    }
    if (typeof receiver === 'string') return this.callStringMethod(receiver, method, values);
    if (typeof receiver === 'number') return this.callNumberMethod(receiver, method, values);
    if (Array.isArray(receiver)) return this.callListMethod(receiver, method, values);
    if (receiver instanceof Date) return this.callDateMethod(receiver, method, values);
    if (receiver instanceof RegExp) {
      if (method !== 'matches') throw new TpsFormulaFailure('unsupported-method', `Unsupported regular expression method ${rawMethod}()`, true);
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'matches() expects one argument');
      const input = String(values[0] ?? '');
      if (input.length > MAX_REGEXP_INPUT_LENGTH) {
        throw new TpsFormulaFailure('regexp-input-too-long', `Regular expression input exceeds ${MAX_REGEXP_INPUT_LENGTH} characters`);
      }
      receiver.lastIndex = 0;
      return receiver.test(input);
    }
    if (isLink(receiver)) {
      if (method === 'asfile') {
        if (values.length) throw new TpsFormulaFailure('wrong-argument-count', 'asFile() expects no arguments');
        throw new TpsFormulaFailure(
          'unsupported-link-resolution',
          'link.asFile() requires vault-wide link resolution, which is unavailable for synthetic rows',
          true,
        );
      }
      if (method === 'linksto') {
        if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'linksTo() expects one argument');
        throw new TpsFormulaFailure(
          'unsupported-link-resolution',
          'link.linksTo() requires reading the linked target file, which is unavailable for synthetic rows',
          true,
        );
      }
    }
    if (isRuntimeFile(receiver)) return this.callFileMethod(receiver, method, values);
    if (receiver && typeof receiver === 'object') {
      if (method === 'keys' || method === 'values') {
        if (values.length) throw new TpsFormulaFailure('wrong-argument-count', `${rawMethod}() expects no arguments`);
        if (method === 'keys') return Object.keys(receiver as object).filter((key) => !key.startsWith('__tps'));
        return Object.entries(receiver as object).filter(([key]) => !key.startsWith('__tps')).map(([, value]) => value);
      }
    }
    throw new TpsFormulaFailure('unsupported-method', `Method ${rawMethod}() is not supported on ${typeName(receiver)}`, true);
  }

  private callStringMethod(receiver: string, method: string, values: unknown[]): unknown {
    if (receiver.length > MAX_RUNTIME_STRING_LENGTH) {
      throw new TpsFormulaFailure(
        'input-too-large',
        `String input exceeds ${MAX_RUNTIME_STRING_LENGTH} characters`,
      );
    }
    if (method === 'contains' || method === 'startswith' || method === 'endswith') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', `${method}() expects one argument`);
      if (method === 'contains') return receiver.includes(String(values[0] ?? ''));
      if (method === 'startswith') return receiver.startsWith(String(values[0] ?? ''));
      return receiver.endsWith(String(values[0] ?? ''));
    }
    if (method === 'containsall' || method === 'containsany') {
      if (!values.length) throw new TpsFormulaFailure('wrong-argument-count', `${method}() expects at least one argument`);
      return method === 'containsall'
        ? values.every((value) => receiver.includes(String(value ?? '')))
        : values.some((value) => receiver.includes(String(value ?? '')));
    }
    if (method === 'lower' || method === 'trim' || method === 'title' || method === 'reverse') {
      if (values.length) throw new TpsFormulaFailure('wrong-argument-count', `${method}() expects no arguments`);
      if (method === 'lower') return receiver.toLocaleLowerCase();
      if (method === 'trim') return receiver.trim();
      if (method === 'title') return titleCase(receiver);
      return Array.from(receiver).reverse().join('');
    }
    if (method === 'repeat') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'repeat() expects one argument');
      const count = Number(values[0]);
      if (!Number.isInteger(count) || count < 0) throw new TpsFormulaFailure('invalid-number', 'repeat() count must be a non-negative integer');
      if (receiver.length * count > MAX_RUNTIME_STRING_LENGTH) {
        throw new TpsFormulaFailure('output-too-large', `repeat() output exceeds ${MAX_RUNTIME_STRING_LENGTH} characters`);
      }
      return receiver.repeat(count);
    }
    if (method === 'slice') {
      if (values.length < 1 || values.length > 2) throw new TpsFormulaFailure('wrong-argument-count', 'slice() expects one or two arguments');
      return receiver.slice(Number(values[0]), values.length > 1 ? Number(values[1]) : undefined);
    }
    if (method === 'split') {
      if (values.length < 1 || values.length > 2) throw new TpsFormulaFailure('wrong-argument-count', 'split() expects one or two arguments');
      const separator = values[0] instanceof RegExp ? values[0] : String(values[0] ?? '');
      const parts = receiver.split(separator);
      if (parts.length > MAX_COLLECTION_ITERATIONS) throw new TpsFormulaFailure('collection-too-large', `split() exceeds ${MAX_COLLECTION_ITERATIONS} items`);
      return values.length > 1 ? parts.slice(0, Number(values[1])) : parts;
    }
    if (method === 'replace') {
      if (values.length !== 2) throw new TpsFormulaFailure('wrong-argument-count', 'replace() expects two arguments');
      const pattern = values[0];
      if (receiver.length > MAX_REGEXP_INPUT_LENGTH) {
        throw new TpsFormulaFailure('regexp-input-too-long', `replace() input exceeds ${MAX_REGEXP_INPUT_LENGTH} characters`);
      }
      const result = pattern instanceof RegExp
        ? receiver.replace(pattern, String(values[1] ?? ''))
        : receiver.split(String(pattern ?? '')).join(String(values[1] ?? ''));
      if (result.length > MAX_RUNTIME_STRING_LENGTH) {
        throw new TpsFormulaFailure('output-too-large', `replace() output exceeds ${MAX_RUNTIME_STRING_LENGTH} characters`);
      }
      return result;
    }
    throw new TpsFormulaFailure('unsupported-method', `Unsupported string method ${method}()`, true);
  }

  private callNumberMethod(receiver: number, method: string, values: unknown[]): unknown {
    if (method === 'abs' || method === 'ceil' || method === 'floor') {
      if (values.length) throw new TpsFormulaFailure('wrong-argument-count', `${method}() expects no arguments`);
      if (method === 'abs') return Math.abs(receiver);
      if (method === 'ceil') return Math.ceil(receiver);
      return Math.floor(receiver);
    }
    if (method === 'round') {
      if (values.length > 1) throw new TpsFormulaFailure('wrong-argument-count', 'round() expects zero or one argument');
      const digits = values.length ? Number(values[0]) : 0;
      if (!Number.isInteger(digits) || Math.abs(digits) > 100) throw new TpsFormulaFailure('invalid-number', 'round() digits must be an integer from -100 to 100');
      const factor = 10 ** digits;
      return Math.round((receiver + Number.EPSILON) * factor) / factor;
    }
    if (method === 'tofixed') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'toFixed() expects one argument');
      return receiver.toFixed(Number(values[0]));
    }
    throw new TpsFormulaFailure('unsupported-method', `Unsupported number method ${method}()`, true);
  }

  private callListMethod(receiver: unknown[], method: string, values: unknown[]): unknown {
    if (receiver.length > MAX_COLLECTION_ITERATIONS) {
      throw new TpsFormulaFailure('collection-too-large', `${method}() exceeds ${MAX_COLLECTION_ITERATIONS} items`);
    }
    if (method === 'contains') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'contains() expects one argument');
      return receiver.some((item) => valuesEqual(item, values[0]));
    }
    if (method === 'containsall' || method === 'containsany') {
      if (!values.length) throw new TpsFormulaFailure('wrong-argument-count', `${method}() expects at least one argument`);
      return method === 'containsall'
        ? values.every((value) => receiver.some((item) => valuesEqual(item, value)))
        : values.some((value) => receiver.some((item) => valuesEqual(item, value)));
    }
    if (method === 'flat' || method === 'reverse' || method === 'sort' || method === 'unique' || method === 'mean') {
      if (values.length) throw new TpsFormulaFailure('wrong-argument-count', `${method}() expects no arguments`);
      if (method === 'flat') return flattenList(receiver);
      if (method === 'reverse') return [...receiver].reverse();
      if (method === 'sort') return [...receiver].sort(compareValues);
      if (method === 'unique') return uniqueList(receiver);
      const numbers = receiver.map(Number).filter(Number.isFinite);
      return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
    }
    if (method === 'join') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'join() expects one argument');
      const result = receiver.map(formatTpsFormulaValue).join(String(values[0] ?? ''));
      if (result.length > MAX_RUNTIME_STRING_LENGTH) throw new TpsFormulaFailure('output-too-large', `join() output exceeds ${MAX_RUNTIME_STRING_LENGTH} characters`);
      return result;
    }
    if (method === 'slice') {
      if (values.length < 1 || values.length > 2) throw new TpsFormulaFailure('wrong-argument-count', 'slice() expects one or two arguments');
      return receiver.slice(Number(values[0]), values.length > 1 ? Number(values[1]) : undefined);
    }
    throw new TpsFormulaFailure('unsupported-method', `Unsupported list method ${method}()`, true);
  }

  private callDateMethod(receiver: Date, method: string, values: unknown[]): unknown {
    if (method === 'date') {
      if (values.length) throw new TpsFormulaFailure('wrong-argument-count', 'date() expects no arguments');
      const value = new Date(receiver.getTime());
      value.setHours(0, 0, 0, 0);
      return value;
    }
    if (method === 'format') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'format() expects one argument');
      return formatDate(receiver, String(values[0] ?? ''));
    }
    if (method === 'time' || method === 'relative') {
      if (values.length) throw new TpsFormulaFailure('wrong-argument-count', `${method}() expects no arguments`);
      return method === 'time' ? formatDate(receiver, 'HH:mm:ss') : relativeDate(receiver, this.nowValue);
    }
    throw new TpsFormulaFailure('unsupported-method', `Unsupported date method ${method}()`, true);
  }

  private callFileMethod(receiver: TpsRuntimeFileValue, method: string, values: unknown[]): unknown {
    if (method === 'aslink') {
      if (values.length > 1) throw new TpsFormulaFailure('wrong-argument-count', 'asLink() expects zero or one argument');
      return Object.freeze({ __tpsFormulaType: 'link', path: receiver.path, ...(values.length ? { display: values[0] } : {}) }) as TpsFormulaLinkValue;
    }
    if (method === 'hasproperty') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'hasProperty() expects one argument');
      return findKey(receiver.properties, values[0]) != null;
    }
    if (method === 'hastag') {
      const tags = (receiver.tags ?? []).map((value) => String(value ?? '').replace(/^#/u, '').toLocaleLowerCase());
      return values.some((value) => {
        const expected = String(value ?? '').replace(/^#/u, '').toLocaleLowerCase();
        return tags.some((tag) => tag === expected || tag.startsWith(`${expected}/`));
      });
    }
    if (method === 'infolder') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'inFolder() expects one argument');
      const expected = String(values[0] ?? '').replace(/^\/+|\/+$/gu, '').toLocaleLowerCase();
      const folder = String(receiver.folder || '').replace(/^\/+|\/+$/gu, '').toLocaleLowerCase();
      return folder === expected || folder.startsWith(`${expected}/`);
    }
    if (method === 'haslink') {
      if (values.length !== 1) throw new TpsFormulaFailure('wrong-argument-count', 'hasLink() expects one argument');
      return (receiver.links ?? []).some((link) => valuesEqual(link, values[0]));
    }
    throw new TpsFormulaFailure('unsupported-method', `Unsupported file method ${method}()`, true);
  }
}

export function formatTpsFormulaValue(value: unknown): string {
  return formatTpsFormulaValueInternal(value, new WeakSet<object>(), 0);
}

function formatTpsFormulaValueInternal(value: unknown, seen: WeakSet<object>, depth: number): string {
  const normalizedValue = normalizePublicBasesValue(value);
  if (normalizedValue !== value) return formatTpsFormulaValueInternal(normalizedValue, seen, depth);
  if (value == null) return '';
  if (value instanceof Date) {
    const hasTime = value.getHours() !== 0 || value.getMinutes() !== 0 || value.getSeconds() !== 0 || value.getMilliseconds() !== 0;
    return formatDate(value, hasTime ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD');
  }
  if (isDuration(value)) return `${durationToMilliseconds(value)}`;
  if (isLink(value)) return value.display == null ? value.path : formatTpsFormulaValueInternal(value.display, seen, depth + 1);
  if (isRuntimeFile(value)) return value.path;
  if (Array.isArray(value)) {
    if (depth > MAX_PARSE_DEPTH || seen.has(value)) return '[Circular]';
    seen.add(value);
    const output = value
      .slice(0, MAX_COLLECTION_ITERATIONS)
      .map((item) => formatTpsFormulaValueInternal(item, seen, depth + 1))
      .filter(Boolean)
      .join(', ');
    seen.delete(value);
    return output.slice(0, MAX_RUNTIME_STRING_LENGTH);
  }
  if (value instanceof RegExp) return value.toString();
  if (typeof value === 'object') {
    if (depth > MAX_PARSE_DEPTH || seen.has(value as object)) return '[Circular]';
    try {
      const visited = new WeakSet<object>();
      const output = JSON.stringify(value, (_key, candidate) => {
        if (!candidate || typeof candidate !== 'object') return candidate;
        if (seen.has(candidate) || visited.has(candidate)) return '[Circular]';
        visited.add(candidate);
        return candidate;
      });
      return String(output ?? '').slice(0, MAX_RUNTIME_STRING_LENGTH);
    } catch {
      return '[Unserializable]';
    }
  }
  return String(value).slice(0, MAX_RUNTIME_STRING_LENGTH);
}

export function getTpsFormulaComparableValues(value: unknown): unknown[] {
  const normalized = normalizePublicBasesValue(value);
  if (normalized == null) return [];
  if (Array.isArray(normalized)) {
    return flattenList(normalized)
      .map((item) => normalizePublicBasesValue(item))
      .filter((item) => item != null);
  }
  return [normalized];
}

export function getTpsFormulaSortKey(value: unknown): string {
  value = normalizePublicBasesValue(value);
  if (value == null) return '';
  if (value instanceof Date) return `2:${String(value.getTime()).padStart(16, '0')}`;
  if (isDuration(value)) return getTpsFormulaSortKey(durationToMilliseconds(value));
  if (isLink(value)) return `3:${normalizeLinkPath(value.path)}`;
  if (isRuntimeFile(value)) return `3:${normalizeLinkPath(value.path)}`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    const sign = value < 0 ? '0' : '1';
    const magnitude = Math.abs(value).toFixed(12).padStart(32, '0');
    return `1:${sign}:${value < 0 ? Array.from(magnitude).map((char) => /\d/u.test(char) ? String(9 - Number(char)) : char).join('') : magnitude}`;
  }
  if (typeof value === 'boolean') return `0:${value ? '1' : '0'}`;
  return `3:${formatTpsFormulaValue(value).toLocaleLowerCase()}`;
}

export function compareTpsFormulaValues(left: unknown, right: unknown): number {
  left = normalizePublicBasesValue(left);
  right = normalizePublicBasesValue(right);
  if (left instanceof Date || right instanceof Date) {
    const leftDate = toDate(left);
    const rightDate = toDate(right);
    if (leftDate && rightDate) return leftDate.getTime() === rightDate.getTime() ? 0 : leftDate.getTime() < rightDate.getTime() ? -1 : 1;
  }
  if (isDuration(left) || isDuration(right)) {
    const leftDuration = parseDuration(left);
    const rightDuration = parseDuration(right);
    if (leftDuration && rightDuration) {
      const leftMilliseconds = durationToMilliseconds(leftDuration);
      const rightMilliseconds = durationToMilliseconds(rightDuration);
      return leftMilliseconds === rightMilliseconds ? 0 : leftMilliseconds < rightMilliseconds ? -1 : 1;
    }
  }
  if (isLink(left) || isLink(right) || isRuntimeFile(left) || isRuntimeFile(right)) {
    const leftPath = getComparablePath(left);
    const rightPath = getComparablePath(right);
    return normalizeLinkPath(leftPath).localeCompare(normalizeLinkPath(rightPath), undefined, { numeric: true, sensitivity: 'base' });
  }
  if (typeof left === 'number' || typeof right === 'number') {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (String(left ?? '').trim() && String(right ?? '').trim() && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1;
    }
  }
  return compareValues(left, right);
}

export function getTpsFormulaGroupValues(value: unknown): string[] {
  const values = value instanceof Set
    ? Array.from(value)
    : getTpsFormulaComparableValues(value);
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const text = isLink(item) || isRuntimeFile(item)
      ? item.path.trim()
      : formatTpsFormulaValue(item).trim();
    if (!text || /^(?:null|undefined)$/iu.test(text)) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

export class TpsBaseFormulaService {
  readonly version = TPS_FORMULA_API_VERSION;
  private readonly compiledCache = new Map<string, TpsCompiledFormulaSet>();

  compile(rawDefinitions: unknown, sourceId = ''): TpsCompiledFormulaSet {
    const definitions = normalizeDefinitions(rawDefinitions);
    const revision = formulaRevision(definitions);
    const cacheKey = `${sourceId}\u0000${revision}`;
    const cached = this.compiledCache.get(cacheKey);
    if (cached && definitionsEqual(cached.definitions, definitions)) {
      this.compiledCache.delete(cacheKey);
      this.compiledCache.set(cacheKey, cached);
      return cached;
    }
    const programs = new Map<string, CompiledProgram>();
    const namesByLowerCase = new Map<string, string>();
    let definitionCount = 0;
    let totalDefinitionLength = 0;
    for (const [name, expression] of Object.entries(definitions)) {
      if (!namesByLowerCase.has(name.toLocaleLowerCase())) namesByLowerCase.set(name.toLocaleLowerCase(), name);
      definitionCount += 1;
      totalDefinitionLength += name.length + expression.length;
      if (definitionCount > MAX_FORMULA_DEFINITIONS) {
        programs.set(name, {
          expression,
          ast: null,
          error: new TpsFormulaFailure('too-many-formulas', `Base exceeds ${MAX_FORMULA_DEFINITIONS} formula definitions`),
        });
        continue;
      }
      if (totalDefinitionLength > MAX_TOTAL_DEFINITION_LENGTH) {
        programs.set(name, {
          expression,
          ast: null,
          error: new TpsFormulaFailure('definition-set-too-large', `Base formula source exceeds ${MAX_TOTAL_DEFINITION_LENGTH} characters`),
        });
        continue;
      }
      try {
        programs.set(name, { expression, ast: parseFormula(expression) });
      } catch (error) {
        programs.set(name, {
          expression,
          ast: null,
          error: error instanceof TpsFormulaFailure
            ? error
            : new TpsFormulaFailure('syntax-error', error instanceof Error ? error.message : String(error)),
        });
      }
    }
    const compiled: TpsCompiledFormulaSet = Object.freeze({
      version: TPS_FORMULA_API_VERSION,
      sourceId,
      revision,
      definitions: Object.freeze({ ...definitions }),
      programs,
      namesByLowerCase,
    });
    this.compiledCache.set(cacheKey, compiled);
    while (this.compiledCache.size > MAX_COMPILED_CACHE_ENTRIES) {
      const oldest = this.compiledCache.keys().next().value;
      if (oldest == null) break;
      this.compiledCache.delete(oldest);
    }
    return compiled;
  }

  createSession(compiled: TpsCompiledFormulaSet, context: TpsFormulaRecordContext): TpsFormulaRowSession {
    if (!compiled || compiled.version !== TPS_FORMULA_API_VERSION) {
      throw new TpsFormulaFailure('incompatible-formula-api', `TPS formula API version ${TPS_FORMULA_API_VERSION} is required`);
    }
    return new TpsFormulaRowSession(compiled, context);
  }

  evaluate(compiled: TpsCompiledFormulaSet, formula: string, context: TpsFormulaRecordContext): TpsFormulaResult {
    return this.createSession(compiled, context).get(formula);
  }

  evaluateAll(compiled: TpsCompiledFormulaSet, context: TpsFormulaRecordContext): Record<string, TpsFormulaResult> {
    return this.createSession(compiled, context).getAll();
  }

  evaluateExpression(
    compiled: TpsCompiledFormulaSet,
    expression: string,
    context: TpsFormulaRecordContext,
  ): TpsFormulaResult {
    return this.createSession(compiled, context).evaluateExpression(expression);
  }

  format(value: unknown): string {
    return formatTpsFormulaValue(value);
  }

  comparableValues(value: unknown): unknown[] {
    return getTpsFormulaComparableValues(value);
  }

  sortKey(value: unknown): string {
    return getTpsFormulaSortKey(value);
  }

  groupValues(value: unknown): string[] {
    return getTpsFormulaGroupValues(value);
  }

  compare(left: unknown, right: unknown): number {
    return compareTpsFormulaValues(left, right);
  }

  isTruthy(value: unknown): boolean {
    return isTpsFormulaTruthy(value);
  }

  hasReference(value: unknown): boolean {
    return hasTpsFormulaReference(value);
  }
}

export const tpsBaseFormulaService = new TpsBaseFormulaService();
