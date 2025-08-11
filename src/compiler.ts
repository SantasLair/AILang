import * as fs from 'fs';

export type Scalar = number | string | boolean | null;
export type JSONValue = Scalar | JSONObject | JSONArray;
export interface JSONObject { [k: string]: JSONValue; }
export type JSONArray = JSONValue[];

export interface TaskAST {
  taskId: string;
  input?: JSONValue;
  model?: ModelSpec;
  out?: string;
  nodes: NodeDecl[];
  edges: EdgeDecl[];
  conditions: Condition[];
  actions: ActionStmt[];
  sourceOrder: (ParsedItem & { kind: string })[]; // preserve order for execution
}

export interface ModelSpec {
  type: string;
  args: Record<string, Scalar>;
}

export interface NodeDecl {
  name: string;
  type: string;
  range?: string;
}

export interface EdgeDecl {
  from: string;
  to: string;
}

export interface Condition {
  left: string;
  op?: '==' | '=' | '>=' | '<=' | '>' | '<';
  right?: Scalar;
}

export type Action =
  | { kind: 'emit'; name: string }
  | { kind: 'log'; message: string }
  | { kind: 'set'; name: string; value: Scalar };

export interface ActionStmt {
  condition: Condition;
  action: Action;
}

// Expressions for let-bindings (minimal)
type Expr =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'ident'; name: string }
  | { kind: 'member'; object: Expr; property: string }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Expr; right: Expr };

export interface LetStmt {
  name: string;
  expr: Expr;
}

type ParsedItem =
  | { kind: 'input'; value: JSONValue }
  | { kind: 'model'; value: ModelSpec }
  | { kind: 'out'; value: string }
  | { kind: 'node'; value: NodeDecl }
  | { kind: 'edge'; value: EdgeDecl }
  | { kind: 'cond'; value: Condition }
  | { kind: 'action'; value: ActionStmt }
  | { kind: 'let'; value: LetStmt };

export interface ExecutionResult {
  outputs: Record<string, JSONValue>;
  context: Record<string, any>;
}

/**
 * Public helpers
 */
export function parseSource(source: string): TaskAST {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let idx = 0;

  function peek(): string | null {
    return idx < lines.length ? lines[idx] : null;
  }
  function next(): string | null {
    return idx < lines.length ? lines[idx++] : null;
  }
  function skipEmpty(): void {
    while (true) {
      const l = peek();
      if (l === null) break;
      if (/^\s*(#.*)?$/.test(l)) {
        idx++;
        continue;
      }
      break;
    }
  }

  const items: ParsedItem[] = [];
  let taskId = '';

  // parse task declaration
  skipEmpty();
  const first = next();
  if (!first || !first.trim().startsWith('@')) {
    throw new Error('Expected task declaration like "@task_id:"');
  }
  {
    const m = first.trim().match(/^@([A-Za-z_][\w-]*):\s*$/);
    if (!m) throw new Error('Invalid task declaration');
    taskId = m[1];
  }

  // parse statements
  while (true) {
    skipEmpty();
    const line = peek();
    if (line === null) break;
    const t = line.trim();

    if (t.startsWith('%in:')) {
      next(); // consume
      const payload = readBlockPayload();
      items.push({ kind: 'input', value: payload });
      continue;
    }

    if (t.startsWith('%model:')) {
      next(); // consume
      const mm = t.match(/^%model:([A-Za-z_][\w-]*)\s*(\{.*\})?\s*$/);
      if (!mm) throw new Error('Invalid model block');
      const mtype = mm[1];
      const args: Record<string, Scalar> = {};
      if (mm[2]) {
        const raw = mm[2]!;
        const inner = raw.slice(1, -1).trim();
        if (inner.length) {
          for (const kv of splitTopLevel(inner, ',')) {
            const [k, v] = splitOnce(kv, '=');
            if (!k || v === undefined) throw new Error('Invalid model arg: ' + kv);
            args[k.trim()] = parseScalar(v.trim());
          }
        }
      }
      items.push({ kind: 'model', value: { type: mtype, args } });
      continue;
    }

    if (t.startsWith('%out:')) {
      next(); // consume
      const m = t.match(/^%out:\s*([A-Za-z_][\w-]*)\s*$/);
      if (!m) throw new Error('Invalid out block');
      items.push({ kind: 'out', value: m[1] });
      continue;
    }

    if (t.startsWith('+')) {
      next(); // consume
      const m = t.match(/^\+([A-Za-z_][\w-]*):([A-Za-z_][\w-]*)(\[(.+?)\])?\s*$/);
      if (!m) throw new Error('Invalid node declaration: ' + t);
      items.push({
        kind: 'node',
        value: { name: m[1], type: m[2], range: m[4] },
      });
      continue;
    }

    if (t.startsWith('->')) {
      next(); // consume
      const m = t.match(/^->\s*([A-Za-z_][\w-]*)\s*=>\s*([A-Za-z_][\w-]*)\s*$/);
      if (!m) throw new Error('Invalid edge declaration: ' + t);
      items.push({ kind: 'edge', value: { from: m[1], to: m[2] } });
      continue;
    }

    if (t.startsWith('?')) {
      next(); // consume
      const cond = parseCondition(t.slice(1).trim());
      items.push({ kind: 'cond', value: cond });
      continue;
    }

    if (t.startsWith('!')) {
      next(); // consume
      const mm = t.match(/^!\s*if\s+(.+?)\s+then\s+(.+)\s*$/);
      if (!mm) throw new Error('Invalid action statement: ' + t);
      const cond = parseCondition(mm[1].trim());
      const action = parseAction(mm[2].trim());
      items.push({ kind: 'action', value: { condition: cond, action } });
      continue;
    }

    if (t.startsWith('let ')) {
      next(); // consume
      const mm = t.match(/^let\s+([A-Za-z_][\w-]*)\s*=\s*(.+)\s*$/);
      if (!mm) throw new Error('Invalid let statement: ' + t);
      const name = mm[1];
      const exprText = mm[2];
      const expr = parseExpression(exprText);
      items.push({ kind: 'let', value: { name, expr } });
      continue;
    }

    throw new Error('Unknown statement: ' + t);
  }

  // fold into AST
  const ast: TaskAST = {
    taskId,
    nodes: [],
    edges: [],
    conditions: [],
    actions: [],
    sourceOrder: [],
  };

  for (const it of items) {
    ast.sourceOrder.push({ ...it } as any);
    switch (it.kind) {
      case 'input':
        if (ast.input !== undefined) throw new Error('Duplicate %in block');
        ast.input = it.value;
        break;
      case 'model':
        if (ast.model) throw new Error('Duplicate %model block');
        ast.model = it.value;
        break;
      case 'out':
        if (ast.out) throw new Error('Duplicate %out block');
        ast.out = it.value;
        break;
      case 'node':
        ast.nodes.push(it.value);
        break;
      case 'edge':
        ast.edges.push(it.value);
        break;
      case 'cond':
        ast.conditions.push(it.value);
        break;
      case 'action':
        ast.actions.push(it.value);
        break;
      case 'let':
        // no dedicated AST bucket; order preserved via sourceOrder
        break;
    }
  }

  validateAST(ast);
  return ast;

  // helpers

  function readBlockPayload(): JSONValue {
    // Read lines until the next directive line or EOF
    const buf: string[] = [];
    while (true) {
      const p = peek();
      if (p === null) break;
  if (/^\s*(%model:|%out:|@|\+|->|\?|!|let\b)/.test(p.trim())) break;
      buf.push(next()!);
    }
    const raw = buf.join('\n').trim();
    if (!raw) throw new Error('Empty %in block');
    // Try JSON.parse directly
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('Invalid %in JSON payload');
    }
  }
}

export function execute(ast: TaskAST): ExecutionResult {
  const outputs: Record<string, JSONValue> = {};
  const ctx: Record<string, any> = {};

  // Seed context with input
  ctx.input = ast.input;
  if (isObject(ast.input)) {
    Object.assign(ctx, ast.input as JSONObject);
  }

  for (const step of ast.sourceOrder) {
    switch (step.kind) {
      case 'input':
        // already seeded
        break;
      case 'model':
        applyModel(step.value as ModelSpec, ctx);
        break;
      case 'out': {
        const outName = step.value as string;
        const value = selectPreferredValue(ctx);
        outputs[outName] = cloneJSON(value);
        break;
      }
      case 'cond':
        // Conditions are declarative hints; no immediate side effect
        break;
      case 'action': {
        const act = step.value as ActionStmt;
        if (evalCondition(act.condition, ctx)) {
          runAction(act.action, ctx, outputs);
        }
        break;
      }
      case 'let': {
        const s = step.value as LetStmt;
        ctx[s.name] = evalExpression(s.expr, ctx);
        break;
      }
      case 'node':
      case 'edge':
        // Not executed; available for future graph-based semantics
        break;
    }
  }

  return { outputs, context: ctx };
}

/**
 * High-level helpers for CLI/tests
 */
export async function parseAndExecuteFile(filePath: string): Promise<ExecutionResult> {
  const src = await fs.promises.readFile(filePath, 'utf8');
  const ast = parseSource(src);
  return execute(ast);
}

export function parseAndExecuteSource(source: string): ExecutionResult {
  return execute(parseSource(source));
}

/**
 * Validation
 */
function validateAST(ast: TaskAST) {
  if (!ast.model && !ast.out && ast.actions.length === 0) {
    // Allow pure declarative graphs, but warn if nothing to do
    return;
  }
  // Basic type checks can be extended here
}

/**
 * Model execution
 */
function applyModel(model: ModelSpec, ctx: Record<string, any>) {
  switch (model.type) {
    case 'sort': {
      const algo = (model.args['algorithm'] as string) || 'bubble';
      const key = (model.args['key'] as string) || '';
      const list = inferListFromContext(ctx);
      if (!Array.isArray(list)) {
        throw new Error('Model "sort" requires an array input');
      }
      let result: any[];
      if (algo === 'bubble') {
        result = bubbleSort(list.slice(), key);
      } else if (algo === 'native') {
        result = nativeSort(list.slice(), key);
      } else {
        throw new Error(`Unknown sort algorithm: ${algo}`);
      }
      ctx.sorted = result;
      break;
    }
    case 'tool': {
      // No side-effects here. Capture a request for the outer orchestrator.
      // Example: %model:tool{name="fs.write", file="path", content="..."}
      const req = { kind: 'tool', args: { ...model.args } };
      if (!Array.isArray(ctx.__requests)) ctx.__requests = [];
      ctx.__requests.push(req);
      // Provide a conventional planning surface
      ctx.plan = ctx.__requests;
      break;
    }
    default:
      throw new Error(`Unknown model type: ${model.type}`);
  }
}

function inferListFromContext(ctx: Record<string, any>): any[] | undefined {
  if (Array.isArray(ctx.input)) return ctx.input;
  if (Array.isArray(ctx.list)) return ctx.list;
  if (isObject(ctx.input) && Array.isArray((ctx.input as any).list)) return (ctx.input as any).list;
  return undefined;
}

function bubbleSort(arr: any[], key?: string): any[] {
  const n = arr.length;
  const getv = (x: any) => (key ? x?.[key] : x);
  for (let i = 0; i < n - 1; i++) {
    let swapped = false;
    for (let j = 0; j < n - i - 1; j++) {
      if (getv(arr[j]) > getv(arr[j + 1])) {
        const tmp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = tmp;
        swapped = true;
      }
    }
    if (!swapped) break;
  }
  return arr;
}

function nativeSort(arr: any[], key?: string): any[] {
  const getv = (x: any) => (key ? x?.[key] : x);
  return arr.sort((a, b) => {
    const va = getv(a);
    const vb = getv(b);
    if (va < vb) return -1;
    if (va > vb) return 1;
    return 0;
  });
}

/**
 * Conditions and actions
 */
function parseCondition(text: string): Condition {
  // Supports: lhs op rhs   or just lhs (truthy variable)
  const m = text.match(/^([A-Za-z_][\w-]*)\s*(==|=|>=|<=|>|<)?\s*(.+)?$/);
  if (!m) throw new Error('Invalid condition: ' + text);
  const left = m[1];
  const op = (m[2] as Condition['op']) || undefined;
  let right: Scalar | undefined = undefined;
  if (m[3] !== undefined) {
    right = parseScalar(m[3].trim());
  }
  return { left, op, right };
}

function evalCondition(cond: Condition, ctx: Record<string, any>): boolean {
  const lv = ctx[cond.left];
  if (!cond.op) return Boolean(lv);
  const rv = cond.right as any;
  switch (cond.op) {
    case '=':
    case '==':
      return lv == rv;
    case '>=':
      return lv >= rv;
    case '<=':
      return lv <= rv;
    case '>':
      return lv > rv;
    case '<':
      return lv < rv;
    default:
      return false;
  }
}

function parseAction(text: string): Action {
  // emit NAME | log "msg" | set VAR=VALUE
  let m = text.match(/^emit\s+([A-Za-z_][\w-]*)\s*$/);
  if (m) return { kind: 'emit', name: m[1] };
  m = text.match(/^log\s+("[^"]*"|'[^']*')\s*$/);
  if (m) return { kind: 'log', message: stripQuotes(m[1]) };
  m = text.match(/^set\s+([A-Za-z_][\w-]*)\s*=\s*(.+)\s*$/);
  if (m) return { kind: 'set', name: m[1], value: parseScalar(m[2]) };
  throw new Error('Unknown action: ' + text);
}

function runAction(action: Action, ctx: Record<string, any>, outputs: Record<string, JSONValue>) {
  switch (action.kind) {
    case 'emit': {
      const preferred = ctx[action.name] ?? ctx.sorted ?? ctx.input;
      outputs[action.name] = cloneJSON(preferred);
      break;
    }
    case 'log': {
      // eslint-disable-next-line no-console
      console.log(action.message);
      break;
    }
    case 'set': {
      ctx[action.name] = action.value;
      break;
    }
  }
}

/**
 * Utilities
 */
function selectPreferredValue(ctx: Record<string, any>): JSONValue {
  // Prefer model-derived value if present, otherwise original input; default to null
  const v = ctx.sorted ?? ctx.input ?? null;
  return v as JSONValue;
}

// --- Minimal expression parsing ---
function parseExpression(text: string): Expr {
  const s = text.trim();
  let i = 0;

  function peek(): string | null { return i < s.length ? s[i] : null; }
  function next(): string | null { return i < s.length ? s[i++] : null; }
  function skipWs() { while (i < s.length && /\s/.test(s[i])) i++; }

  function parsePrimary(): Expr {
    skipWs();
    const ch = peek();
    if (ch === '"' || ch === '\'') return { kind: 'string', value: parseString() };
    if (ch && /[0-9+\-]/.test(ch)) {
      const num = parseNumber();
      return { kind: 'number', value: num };
    }
    // keywords or ident/member
    const id = parseIdentifier();
    if (id === 'true') return { kind: 'boolean', value: true };
    if (id === 'false') return { kind: 'boolean', value: false };
    if (id === 'null') return { kind: 'null' };
    let expr: Expr = { kind: 'ident', name: id };
    // member access: .prop .prop ...
    while (true) {
      skipWs();
      if (peek() === '.') {
        next();
        const prop = parseIdentifier();
        expr = { kind: 'member', object: expr, property: prop };
      } else {
        break;
      }
    }
    return expr;
  }

  function parseNumber(): number {
    let buf = '';
    if (s[i] === '+' || s[i] === '-') { buf += s[i++]; }
    while (i < s.length && /[0-9]/.test(s[i])) buf += s[i++];
    if (s[i] === '.') { buf += s[i++]; while (i < s.length && /[0-9]/.test(s[i])) buf += s[i++]; }
    if (!buf || buf === '+' || buf === '-') throw new Error('Invalid number in expression');
    return Number(buf);
  }

  function parseString(): string {
    const quote = next(); // ' or "
    let out = '';
    while (true) {
      const ch = next();
      if (ch === null) throw new Error('Unterminated string');
      if (ch === quote) break;
      out += ch;
    }
    return out;
  }

  function parseIdentifier(): string {
    skipWs();
    const m = s.slice(i).match(/^([A-Za-z_][\w-]*)/);
    if (!m) throw new Error('Expected identifier in expression');
    i += m[1].length;
    return m[1];
  }

  function parseMulDiv(): Expr {
    let left = parsePrimary();
    while (true) {
      skipWs();
      const ch = peek();
      if (ch === '*' || ch === '/') {
        next();
        const right = parsePrimary();
        left = { kind: 'binary', op: ch as any, left, right };
      } else break;
    }
    return left;
  }

  function parseAddSub(): Expr {
    let left = parseMulDiv();
    while (true) {
      skipWs();
      const ch = peek();
      if (ch === '+' || ch === '-') {
        next();
        const right = parseMulDiv();
        left = { kind: 'binary', op: ch as any, left, right };
      } else break;
    }
    return left;
  }

  const expr = parseAddSub();
  skipWs();
  if (i < s.length) throw new Error('Unexpected tokens at end of expression');
  return expr;
}

function evalExpression(e: Expr, ctx: Record<string, any>): any {
  switch (e.kind) {
    case 'number':
      return e.value;
    case 'string':
      return e.value;
    case 'boolean':
      return e.value;
    case 'null':
      return null;
    case 'ident':
      return ctx[e.name];
    case 'member': {
      const obj = evalExpression(e.object, ctx);
      return obj?.[e.property];
    }
    case 'binary': {
      const l = evalExpression(e.left, ctx);
      const r = evalExpression(e.right, ctx);
      switch (e.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return l / r;
      }
    }
  }
}

function splitTopLevel(s: string, delim: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (ch === delim && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function splitOnce(s: string, delim: string): [string, string?] {
  const i = s.indexOf(delim);
  if (i === -1) return [s];
  return [s.slice(0, i), s.slice(i + delim.length)];
}

function parseScalar(txt: string): Scalar {
  const t = txt.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return stripQuotes(t);
  }
  // number?
  if (/^[+-]?\d+(\.\d+)?$/.test(t)) {
    return Number(t);
  }
  // identifier -> treat as string symbol
  return t;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]/, '').replace(/['"]$/, '');
}

function isObject(x: any): x is JSONObject {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function cloneJSON<T extends JSONValue>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}
