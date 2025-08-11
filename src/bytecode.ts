import { JSONArray, JSONValue, JSONObject, TaskAST, ModelSpec, ActionStmt, Condition } from './compiler';

// Simple binary format (little-endian):
// magic 'A','L','B','C' (4 bytes), version u8
// const_count u32
//   entries: type u8 (0=null,1=bool,2=num,3=str) + payload (bool u8, num f64, str u32 len + utf8)
// code_len u32
//   bytecode bytes

export enum Op {
  CONST = 0x01,        // u32 constIdx -> push
  GET_CTX = 0x02,      // u32 nameIdx -> push ctx[name]
  SET_CTX = 0x03,      // u32 nameIdx -> pop -> ctx[name]=v
  MEMBER = 0x04,       // u32 propIdx -> pop obj -> push obj?.[prop]
  ADD = 0x10,          // pop b,a -> push a+b
  SUB = 0x11,          // pop b,a -> push a-b
  MUL = 0x12,          // pop b,a -> push a*b
  DIV = 0x13,          // pop b,a -> push a/b
  CMP_EQ = 0x20,       // pop b,a -> push a==b ? 1:0
  CMP_GE = 0x21,
  CMP_LE = 0x22,
  CMP_GT = 0x23,
  CMP_LT = 0x24,
  JUMP_IF_FALSE = 0x30,// i32 rel offset
  SORT = 0x40,         // u32 algoIdx, u32 keyIdx (0xFFFFFFFF for none) -> ctx.sorted
  EMIT_PREFERRED = 0x50,// u32 nameIdx -> outputs[name] = ctx[name] ?? ctx.sorted ?? ctx.input
  EMIT_TOP = 0x51,     // u32 nameIdx -> pop v -> outputs[name]=v
  END = 0xFF,
}

class ByteWriter {
  private buf = new ArrayBuffer(1024);
  private view = new DataView(this.buf);
  private bytes = new Uint8Array(this.buf);
  private _len = 0;
  private ensure(n: number) {
    if (this._len + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength;
    while (cap < this._len + n) cap *= 2;
    const nb = new ArrayBuffer(cap);
    new Uint8Array(nb).set(this.bytes.subarray(0, this._len));
    this.buf = nb;
    this.view = new DataView(this.buf);
    this.bytes = new Uint8Array(this.buf);
  }
  u8(v: number) { this.ensure(1); this.view.setUint8(this._len, v); this._len += 1; }
  u32(v: number) { this.ensure(4); this.view.setUint32(this._len, v >>> 0, true); this._len += 4; }
  i32(v: number) { this.ensure(4); this.view.setInt32(this._len, v | 0, true); this._len += 4; }
  f64(v: number) { this.ensure(8); this.view.setFloat64(this._len, v, true); this._len += 8; }
  bytesFrom(src: Uint8Array) { this.ensure(src.length); this.bytes.set(src, this._len); this._len += src.length; }
  toUint8Array(): Uint8Array { return this.bytes.slice(0, this._len); }
}

class ConstPool {
  list: any[] = [];
  map = new Map<string, number>();
  getId(val: any): number {
    const key = typeof val + ':' + (typeof val === 'string' ? val : JSON.stringify(val));
    const had = this.map.get(key);
    if (had !== undefined) return had;
    const id = this.list.length;
    this.list.push(val);
    this.map.set(key, id);
    return id;
  }
}

function encodeConstPool(w: ByteWriter, pool: ConstPool) {
  w.u32(pool.list.length);
  for (const v of pool.list) {
    if (v === null) { w.u8(0); }
    else if (typeof v === 'boolean') { w.u8(1); w.u8(v ? 1 : 0); continue; }
    else if (typeof v === 'number') { w.u8(2); w.f64(v); continue; }
    else if (typeof v === 'string') {
      w.u8(3); const enc = new TextEncoder().encode(v); w.u32(enc.length); w.bytesFrom(enc); continue;
    } else {
      // Fallback: JSON string
      const s = JSON.stringify(v);
      w.u8(3); const enc = new TextEncoder().encode(s); w.u32(enc.length); w.bytesFrom(enc);
    }
  }
}

// Public API
export function compileToBytecode(ast: TaskAST): Uint8Array {
  const pool = new ConstPool();
  const code = new ByteWriter();
  const patchSites: number[] = [];

  const emit = (op: Op) => code.u8(op);
  const emitU32 = (v: number) => code.u32(v);
  const emitI32 = (v: number) => code.i32(v);

  function strId(s: string): number { return pool.getId(s); }
  function numId(n: number): number { return pool.getId(n); }
  function boolId(b: boolean): number { return pool.getId(b); }

  // Compile source steps
  for (const step of ast.sourceOrder) {
    switch (step.kind) {
      case 'model': {
        const m = step.value as ModelSpec;
        if (m.type === 'sort') {
          const algo = (m.args['algorithm'] as string) || 'bubble';
          const key = (m.args['key'] as string) || '';
          emit(Op.SORT);
          emitU32(strId(algo));
          emitU32(key ? strId(key) : 0xFFFFFFFF);
        } else if (m.type === 'tool') {
          // Planning is runtime-level; no-op in bytecode for now
        }
        break;
      }
      case 'out': {
        const name = step.value as string;
        emit(Op.EMIT_PREFERRED);
        emitU32(strId(name));
        break;
      }
      case 'let': {
        const { name, expr } = step.value as any; // LetStmt
        compileExpr(expr, pool, code);
        emit(Op.SET_CTX); emitU32(strId(name));
        break;
      }
      case 'action': {
        const a = step.value as ActionStmt;
        compileCond(a.condition, pool, code);
        emit(Op.JUMP_IF_FALSE); const at = (code as any)._len as number; emitI32(0); // patch later
        compileAction(a, pool, code);
        // patch target to end of current code
        const end = (code as any)._len as number;
        const buf = (code as any).view as DataView;
        buf.setInt32(at, end - (at + 4), true);
        break;
      }
      default:
        // inputs/nodes/edges/conds: no-ops in bytecode
        break;
    }
  }

  // Header + const pool + code
  const out = new ByteWriter();
  out.bytesFrom(new TextEncoder().encode('ALBC'));
  out.u8(1); // version
  encodeConstPool(out, pool);
  const codeBytes = code.toUint8Array();
  out.u32(codeBytes.length);
  out.bytesFrom(codeBytes);
  out.u8(Op.END);
  return out.toUint8Array();
}

function compileExpr(expr: any, pool: ConstPool, code: ByteWriter) {
  const emit = (op: Op) => code.u8(op);
  const emitU32 = (v: number) => code.u32(v);
  const sid = (s: string) => pool.getId(s);
  switch (expr.kind) {
    case 'number': code.u8(Op.CONST); emitU32(pool.getId(expr.value)); break;
    case 'string': code.u8(Op.CONST); emitU32(pool.getId(expr.value)); break;
    case 'boolean': code.u8(Op.CONST); emitU32(pool.getId(expr.value)); break;
    case 'null': code.u8(Op.CONST); emitU32(pool.getId(null)); break;
    case 'ident': code.u8(Op.GET_CTX); emitU32(sid(expr.name)); break;
    case 'member': compileExpr(expr.object, pool, code); code.u8(Op.MEMBER); emitU32(sid(expr.property)); break;
    case 'binary':
      compileExpr(expr.left, pool, code); compileExpr(expr.right, pool, code);
      switch (expr.op) {
        case '+': code.u8(Op.ADD); break;
        case '-': code.u8(Op.SUB); break;
        case '*': code.u8(Op.MUL); break;
        case '/': code.u8(Op.DIV); break;
      }
      break;
  }
}

function compileCond(cond: any, pool: ConstPool, code: ByteWriter) {
  const emit = (op: Op) => code.u8(op);
  const emitU32 = (v: number) => code.u32(v);
  const sid = (s: string) => pool.getId(s);
  emit(Op.GET_CTX); emitU32(sid(cond.left));
  if (cond.op) {
    // right may be scalar; put into const pool
    emit(Op.CONST); emitU32(pool.getId(cond.right as any));
    switch (cond.op) {
      case '=':
      case '==': emit(Op.CMP_EQ); break;
      case '>=': emit(Op.CMP_GE); break;
      case '<=': emit(Op.CMP_LE); break;
      case '>': emit(Op.CMP_GT); break;
      case '<': emit(Op.CMP_LT); break;
    }
  }
}

function compileAction(a: ActionStmt, pool: ConstPool, code: ByteWriter) {
  const emit = (op: Op) => code.u8(op);
  const emitU32 = (v: number) => code.u32(v);
  const sid = (s: string) => pool.getId(s);
  switch (a.action.kind) {
    case 'emit':
      emit(Op.EMIT_PREFERRED); emitU32(sid(a.action.name));
      break;
    case 'log':
      // no-op in bytecode for now
      break;
    case 'set':
      // push value, then store
      code.u8(Op.CONST); emitU32(pool.getId(a.action.value));
      code.u8(Op.SET_CTX); emitU32(sid(a.action.name));
      break;
  }
}

export function runBytecode(bin: Uint8Array, input?: JSONValue) {
  // decode header
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const u8 = (o: number) => view.getUint8(o);
  if (new TextDecoder().decode(bin.slice(0, 4)) !== 'ALBC') throw new Error('Bad bytecode magic');
  let off = 4;
  const version = u8(off); off += 1; if (version !== 1) throw new Error('Unsupported bytecode version');
  // const pool
  const constCount = view.getUint32(off, true); off += 4;
  const consts: any[] = [];
  for (let i = 0; i < constCount; i++) {
    const t = u8(off); off += 1;
    switch (t) {
      case 0: consts.push(null); break;
      case 1: consts.push(u8(off) ? true : false); off += 1; break;
      case 2: consts.push(view.getFloat64(off, true)); off += 8; break;
      case 3: {
        const len = view.getUint32(off, true); off += 4;
        const s = new TextDecoder().decode(bin.slice(off, off + len)); off += len;
        consts.push(s);
        break;
      }
      default: throw new Error('Unknown const type');
    }
  }
  // code
  const codeLen = view.getUint32(off, true); off += 4;
  const codeStart = off;
  const codeEnd = off + codeLen;

  const stack: any[] = [];
  const ctx: Record<string, any> = {};
  const outputs: Record<string, JSONValue> = {};
  if (input !== undefined) {
    ctx.input = input;
    if (isObject(input)) Object.assign(ctx, input as JSONObject);
  }

  let ip = codeStart;
  const getStr = (idx: number) => consts[idx] as string;
  const getU32 = () => { const v = view.getUint32(ip, true); ip += 4; return v; };
  const getI32 = () => { const v = view.getInt32(ip, true); ip += 4; return v; };

  const bubbleSort = (arr: any[], key?: string): any[] => {
    const n = arr.length; const getv = (x: any) => (key ? x?.[key] : x);
    for (let i = 0; i < n - 1; i++) { let swapped = false; for (let j = 0; j < n - i - 1; j++) { if (getv(arr[j]) > getv(arr[j + 1])) { const tmp = arr[j]; arr[j] = arr[j + 1]; arr[j + 1] = tmp; swapped = true; } } if (!swapped) break; }
    return arr;
  };

  function prefer(): JSONValue { return (ctx.sorted ?? ctx.input ?? null) as JSONValue; }

  while (ip < codeEnd) {
    const op = u8(ip); ip += 1;
    switch (op) {
      case Op.CONST: { const idx = getU32(); stack.push(consts[idx]); break; }
      case Op.GET_CTX: { const name = getStr(getU32()); stack.push(ctx[name]); break; }
      case Op.SET_CTX: { const name = getStr(getU32()); const v = stack.pop(); ctx[name] = v; break; }
      case Op.MEMBER: { const prop = getStr(getU32()); const obj = stack.pop(); stack.push(obj?.[prop]); break; }
      case Op.ADD: { const b = stack.pop(); const a = stack.pop(); stack.push(a + b); break; }
      case Op.SUB: { const b = stack.pop(); const a = stack.pop(); stack.push(a - b); break; }
      case Op.MUL: { const b = stack.pop(); const a = stack.pop(); stack.push(a * b); break; }
      case Op.DIV: { const b = stack.pop(); const a = stack.pop(); stack.push(a / b); break; }
      case Op.CMP_EQ: { const b = stack.pop(); const a = stack.pop(); stack.push(a == b ? 1 : 0); break; }
      case Op.CMP_GE: { const b = stack.pop(); const a = stack.pop(); stack.push(a >= b ? 1 : 0); break; }
      case Op.CMP_LE: { const b = stack.pop(); const a = stack.pop(); stack.push(a <= b ? 1 : 0); break; }
      case Op.CMP_GT: { const b = stack.pop(); const a = stack.pop(); stack.push(a > b ? 1 : 0); break; }
      case Op.CMP_LT: { const b = stack.pop(); const a = stack.pop(); stack.push(a < b ? 1 : 0); break; }
      case Op.JUMP_IF_FALSE: { const rel = getI32(); const v = stack.pop(); if (!v) { ip += rel; } break; }
      case Op.SORT: { const algo = getStr(getU32()); const keyIdx = getU32(); const key = keyIdx === 0xFFFFFFFF ? undefined : getStr(keyIdx); const list = Array.isArray(ctx.input) ? ctx.input : (Array.isArray(ctx.list) ? ctx.list : (isObject(ctx.input) && Array.isArray((ctx.input as any).list) ? (ctx.input as any).list : undefined)); if (!Array.isArray(list)) throw new Error('Model "sort" requires an array input'); const arr = list.slice(); const res = (algo === 'native') ? arr.sort((a, b) => { const va: any = key ? a?.[key] : a; const vb: any = key ? b?.[key] : b; return va < vb ? -1 : va > vb ? 1 : 0; }) : bubbleSort(arr, key); ctx.sorted = res; break; }
      case Op.EMIT_PREFERRED: { const name = getStr(getU32()); const preferred = ctx[name] ?? ctx.sorted ?? ctx.input; outputs[name] = cloneJSON(preferred); break; }
      case Op.EMIT_TOP: { const name = getStr(getU32()); const v = stack.pop(); outputs[name] = cloneJSON(v as any); break; }
      default: ip = codeEnd; break;
    }
  }

  return { outputs, context: ctx };
}

function isObject(x: any): x is JSONObject { return typeof x === 'object' && x !== null && !Array.isArray(x); }
function cloneJSON<T extends JSONValue>(v: T): T { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
