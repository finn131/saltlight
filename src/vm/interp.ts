import { type Stmt, type Expr } from './parser';
import { makeBuiltins } from './builtins';

export const OPS_PER_SLICE = 200_000;
export const HARD_OP_CAP = 50_000_000;

export class OpCapError extends Error {
  ops: number;
  constructor(ops: number) {
    super(`instruction budget exceeded after ${ops} ops`);
    this.name = 'OpCapError';
    this.ops = ops;
  }
}

export class RuntimeError extends Error {
  line: number;
  col?: number;
  constructor(message: string, line: number, col?: number) {
    super(col === undefined ? `${message} (line ${line})` : `${message} (line ${line}, col ${col})`);
    this.name = 'RuntimeError';
    this.line = line;
    this.col = col;
  }
}

export type StepResult = 'slice' | 'done';

export interface InterpOptions {
  builtins?: Record<string, (...args: unknown[]) => unknown>;
  hardCap?: number;
  world?: unknown;
  mote?: unknown;
}

interface LoamFunction {
  readonly __loam_fn: true;
  readonly name: string;
  readonly params: string[];
  readonly body: Stmt[];
}

const BREAK_SIG = Symbol('break');
const CONTINUE_SIG = Symbol('continue');

class ReturnSignal {
  readonly value: unknown;
  constructor(value: unknown) { this.value = value; }
}

function typeName(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'string') return 'str';
  if (Array.isArray(v)) return 'list';
  if (isLoamFn(v)) return 'function';
  if (typeof v === 'function') return 'builtin';
  if (typeof v === 'object') return 'dict';
  return 'unknown';
}

function isLoamFn(v: unknown): v is LoamFunction {
  return typeof v === 'object' && v !== null && (v as LoamFunction).__loam_fn === true;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !isLoamFn(v) && typeof v !== 'function';
}

function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (isPlainObject(v)) return Object.keys(v).length > 0;
  return true;
}

function eq(l: unknown, r: unknown): boolean {
  if (l === null && r === null) return true;
  if (Array.isArray(l) && Array.isArray(r)) {
    if (l.length !== r.length) return false;
    for (let i = 0; i < l.length; i++) if (!eq(l[i], r[i])) return false;
    return true;
  }
  if (isPlainObject(l) && isPlainObject(r)) {
    const lk = Object.keys(l), rk = Object.keys(r);
    if (lk.length !== rk.length) return false;
    for (const k of lk) if (!(k in r) || !eq(l[k], r[k])) return false;
    return true;
  }
  const ln = typeof l === 'boolean' ? (l ? 1 : 0) : l;
  const rn = typeof r === 'boolean' ? (r ? 1 : 0) : r;
  if (typeof ln === 'number' && typeof rn === 'number') return ln === rn;
  if (typeof ln === 'string' && typeof rn === 'string') return ln === rn;
  if (ln === null || rn === null) return false;
  return false;
}

function pymod(a: number, b: number): number {
  const r = a % b;
  if (r !== 0 && (r < 0) !== (b < 0)) return r + b;
  return r;
}

function cmp(op: string, l: unknown, r: unknown, line: number): boolean {
  const ln = typeof l === 'boolean' ? (l ? 1 : 0) : l;
  const rn = typeof r === 'boolean' ? (r ? 1 : 0) : r;
  if (typeof ln === 'number' && typeof rn === 'number') {
    switch (op) {
      case '<': return ln < rn;
      case '<=': return ln <= rn;
      case '>': return ln > rn;
      case '>=': return ln >= rn;
    }
  }
  if (typeof ln === 'string' && typeof rn === 'string') {
    switch (op) {
      case '<': return ln < rn;
      case '<=': return ln <= rn;
      case '>': return ln > rn;
      case '>=': return ln >= rn;
    }
  }
  throw new RuntimeError(`cannot compare ${typeName(l)} with ${typeName(r)}`, line);
}

export class Interp {
  readonly reports: string[];
  ops = 0;
  lastLine = 0;
  /** Number of user-defined function invocations at runtime (task scoring). */
  userCalls = 0;
  private root: Generator<void, void, void> | null = null;
  private hardCap: number;
  private env = new Map<string, unknown>();

  constructor(stmts: Stmt[], opts?: InterpOptions) {
    this.hardCap = opts?.hardCap ?? HARD_OP_CAP;
    const reports: string[] = [];
    this.reports = reports;
    const builtins = opts?.builtins ?? makeBuiltins({ reports, mote: opts?.mote ?? null, world: opts?.world ?? null });
    for (const [k, v] of Object.entries(builtins)) this.env.set(k, v);
    this.root = this.runRoot(stmts);
  }

  callRule(fn: unknown, ctx: Record<string, unknown>): unknown {
    if (typeof fn === 'function') return (fn as (c: unknown) => unknown)(ctx);
    if (!isLoamFn(fn)) throw new Error('callRule expects a function');
    const fn2 = fn as unknown as LoamFunction;
    const saved: Array<{ name: string; had: boolean; val: unknown }> = [];
    const bind = (name: string, val: unknown): void => {
      saved.push({ name, had: this.env.has(name), val: this.env.get(name) });
      this.env.set(name, val);
    };
    if (fn2.params.length > 0) bind(fn2.params[0], ctx);
    for (let i = 1; i < fn2.params.length; i++) bind(fn2.params[i], null);
    try {
      const gen = this.execList(fn2.body);
      for (;;) {
        if (this.ops > this.hardCap) throw new OpCapError(this.ops);
        const r = gen.next();
        if (r.done) return null;
      }
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    } finally {
      for (const s of saved) {
        if (s.had) this.env.set(s.name, s.val);
        else this.env.delete(s.name);
      }
    }
  }

  getEnv(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of this.env) out[k] = v;
    return out;
  }

  step(): StepResult {
    if (!this.root) return 'done';
    const start = this.ops;
    while (this.ops - start < OPS_PER_SLICE) {
      if (this.ops > this.hardCap) throw new OpCapError(this.ops);
      const r = this.root.next();
      if (r.done) { this.root = null; return 'done'; }
    }
    return 'slice';
  }

  run(): void {
    while (this.step() === 'slice') { /* continue */ }
  }

  private *runRoot(stmts: Stmt[]): Generator<void, void, void> {
    try {
      yield* this.execList(stmts);
    } catch (e) {
      if (e === BREAK_SIG) throw new RuntimeError('break outside loop', 0);
      if (e === CONTINUE_SIG) throw new RuntimeError('continue outside loop', 0);
      if (e instanceof ReturnSignal) throw new RuntimeError('return outside function', 0);
      throw e;
    }
  }

  private *execList(stmts: Stmt[]): Generator<void, void, void> {
    for (const s of stmts) yield* this.execStmt(s);
  }

  private *execStmt(stmt: Stmt): Generator<void, void, void> {
    this.ops++;
    this.lastLine = stmt.line;
    // ponytail: one yield per statement is the suspension point; step() regains
    // control here and enforces the slice budget + hard cap.
    yield;
    switch (stmt.kind) {
      case 'assign': {
        const value = yield* this.evalExpr(stmt.value);
        if (stmt.op) {
          yield* this.augAssign(stmt.target, value, stmt.op, stmt.line);
        } else {
          yield* this.assign(stmt.target, value, stmt.line);
        }
        return;
      }
      case 'if': {
        for (const { test, body } of stmt.branches) {
          const v = yield* this.evalExpr(test);
          if (truthy(v)) {
            yield* this.execList(body);
            return;
          }
        }
        if (stmt.orelse) yield* this.execList(stmt.orelse);
        return;
      }
      case 'while': {
        for (;;) {
          const v = yield* this.evalExpr(stmt.test);
          if (!truthy(v)) break;
          try {
            yield* this.execList(stmt.body);
          } catch (e) {
            if (e === BREAK_SIG) break;
            if (e === CONTINUE_SIG) continue;
            throw e;
          }
        }
        return;
      }
      case 'for': {
        const from = toInt(yield* this.evalExpr(stmt.from), stmt.line);
        const to = toInt(yield* this.evalExpr(stmt.to), stmt.line);
        for (let i = from; i < to; i++) {
          this.env.set(stmt.name, i);
          try {
            yield* this.execList(stmt.body);
          } catch (e) {
            if (e === BREAK_SIG) break;
            if (e === CONTINUE_SIG) continue;
            throw e;
          }
        }
        return;
      }
      case 'def': {
        const fn: LoamFunction = { __loam_fn: true, name: stmt.name, params: stmt.params, body: stmt.body };
        this.env.set(stmt.name, fn);
        return;
      }
      case 'return': {
        const v = stmt.value ? yield* this.evalExpr(stmt.value) : null;
        throw new ReturnSignal(v);
      }
      case 'break': throw BREAK_SIG;
      case 'continue': throw CONTINUE_SIG;
      case 'pass': return;
      case 'expr': { yield* this.evalExpr(stmt.value); return; }
    }
  }

  private *assign(target: Expr, value: unknown, line: number): Generator<void, void, void> {
    if (target.kind === 'name') {
      this.env.set(target.id, value);
      return;
    }
    if (target.kind === 'index') {
      const t = yield* this.evalExpr(target.target);
      const idx = yield* this.evalExpr(target.index);
      if (Array.isArray(t)) {
        let i = toInt(idx, line);
        if (i < 0) i += t.length;
        if (i < 0 || i >= t.length) throw new RuntimeError('list index out of range', line);
        t[i] = value;
        return;
      }
      if (isPlainObject(t)) {
        t[String(idx)] = value;
        return;
      }
      throw new RuntimeError(`cannot index assign into ${typeName(t)}`, line);
    }
    if (target.kind === 'member') {
      const t = yield* this.evalExpr(target.target);
      if (isPlainObject(t)) {
        t[target.name] = value;
        return;
      }
      throw new RuntimeError(`cannot index assign into ${typeName(t)}`, line);
    }
    throw new RuntimeError('invalid assignment target', line);
  }

  private *augAssign(target: Expr, value: unknown, op: string, line: number): Generator<void, void, void> {
    if (target.kind === 'name') {
      const cur = this.env.get(target.id);
      const next = binop(op.slice(0, -1), cur, value, line);
      this.env.set(target.id, next);
      return;
    }
    if (target.kind === 'index') {
      const t = yield* this.evalExpr(target.target);
      const idx = yield* this.evalExpr(target.index);
      if (Array.isArray(t)) {
        let i = toInt(idx, line);
        if (i < 0) i += t.length;
        if (i < 0 || i >= t.length) throw new RuntimeError('list index out of range', line);
        t[i] = binop(op.slice(0, -1), t[i], value, line);
        return;
      }
      if (isPlainObject(t)) {
        t[String(idx)] = binop(op.slice(0, -1), t[String(idx)], value, line);
        return;
      }
      throw new RuntimeError(`cannot index assign into ${typeName(t)}`, line);
    }
    if (target.kind === 'member') {
      const t = yield* this.evalExpr(target.target);
      if (isPlainObject(t)) {
        t[target.name] = binop(op.slice(0, -1), t[target.name], value, line);
        return;
      }
      throw new RuntimeError(`cannot index assign into ${typeName(t)}`, line);
    }
    throw new RuntimeError('invalid assignment target', line);
  }

  private *evalExpr(e: Expr): Generator<void, unknown, void> {
    this.ops++;
    switch (e.kind) {
      case 'num': return e.value;
      case 'str': return e.value;
      case 'bool': return e.value;
      case 'none': return null;
      case 'name': {
        const v = this.env.get(e.id);
        if (v === undefined) throw new RuntimeError(`${e.id} is not defined`, e.line);
        return v;
      }
      case 'binop': {
        // ponytail: and/or short-circuit here, not in binop, so the right side is never touched.
        if (e.op === 'and') {
          const l = yield* this.evalExpr(e.left);
          if (!truthy(l)) return false;
          const r = yield* this.evalExpr(e.right);
          return truthy(r);
        }
        if (e.op === 'or') {
          const l = yield* this.evalExpr(e.left);
          if (truthy(l)) return true;
          const r = yield* this.evalExpr(e.right);
          return truthy(r);
        }
        const l = yield* this.evalExpr(e.left);
        const r = yield* this.evalExpr(e.right);
        return binop(e.op, l, r, e.line);
      }
      case 'unop': {
        const v = yield* this.evalExpr(e.operand);
        if (e.op === 'not') return !truthy(v);
        if (e.op === '+') {
          if (typeof v === 'number') return v;
          throw new RuntimeError(`bad operand type for unary +: ${typeName(v)}`, e.line);
        }
        if (e.op === '-') {
          if (typeof v === 'number') return -v;
          if (typeof v === 'boolean') return v ? -1 : 0;
          throw new RuntimeError(`bad operand type for unary -: ${typeName(v)}`, e.line);
        }
        throw new RuntimeError(`unknown unary op ${e.op}`, e.line);
      }
      case 'call': {
        if (e.callee.kind !== 'name') throw new RuntimeError('invalid callee', e.line);
        const callee = this.env.get(e.callee.id);
        if (callee === undefined) throw new RuntimeError(`${e.callee.id} is not defined`, e.line);
        const args: unknown[] = [];
        for (const a of e.args) args.push(yield* this.evalExpr(a));
        if (isLoamFn(callee)) {
          this.userCalls++;
          if (args.length !== callee.params.length) {
            throw new RuntimeError(`${callee.name}() takes ${callee.params.length} ${callee.params.length === 1 ? 'argument' : 'arguments'} but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`, e.line);
          }
          const saved: Array<{ param: string; had: boolean; val: unknown }> = [];
          for (const p of callee.params) {
            const had = this.env.has(p);
            const val = this.env.get(p);
            saved.push({ param: p, had, val });
            this.env.set(p, args.shift() as unknown);
          }
          try {
            yield* this.execList(callee.body);
            return null;
          } catch (err) {
            if (err instanceof ReturnSignal) return err.value;
            if (err === BREAK_SIG || err === CONTINUE_SIG) {
              throw new RuntimeError(`${err === BREAK_SIG ? 'break' : 'continue'} outside loop`, e.line);
            }
            throw err;
          } finally {
            for (const s of saved) {
              if (s.had) this.env.set(s.param, s.val);
              else this.env.delete(s.param);
            }
          }
        }
        if (typeof callee === 'function') {
          return (callee as (...a: unknown[]) => unknown)(...args);
        }
        throw new RuntimeError(`${e.callee.id} is not callable`, e.line);
      }
      case 'index': {
        const t = yield* this.evalExpr(e.target);
        const idx = yield* this.evalExpr(e.index);
        if (Array.isArray(t)) {
          let i = toInt(idx, e.line);
          if (i < 0) i += t.length;
          if (i < 0 || i >= t.length) throw new RuntimeError('list index out of range', e.line);
          return t[i];
        }
        if (isPlainObject(t)) {
          const k = String(idx);
          if (!(k in t)) throw new RuntimeError(`key not found: ${k}`, e.line);
          return t[k];
        }
        throw new RuntimeError(`cannot index into ${typeName(t)}`, e.line);
      }
      case 'member': {
        const t = yield* this.evalExpr(e.target);
        if (isPlainObject(t)) {
          if (!(e.name in t)) throw new RuntimeError(`key not found: ${e.name}`, e.line);
          return t[e.name];
        }
        throw new RuntimeError(`cannot access member ${e.name} on ${typeName(t)}`, e.line);
      }
      case 'list': {
        const items: unknown[] = [];
        for (const it of e.items) items.push(yield* this.evalExpr(it));
        return items;
      }
      case 'dict': {
        const obj: Record<string, unknown> = {};
        for (const [kExpr, vExpr] of e.entries) {
          const k = yield* this.evalExpr(kExpr);
          const v = yield* this.evalExpr(vExpr);
          obj[String(k)] = v;
        }
        return obj;
      }
    }
  }
}

function toInt(v: unknown, line: number): number {
  if (typeof v !== 'number') throw new RuntimeError('range arguments must be int', line);
  return Math.trunc(v);
}

function binop(op: string, l: unknown, r: unknown, line: number): unknown {
  switch (op) {
    case '+':
      if (typeof l === 'number' && typeof r === 'number') return l + r;
      if (typeof l === 'string' && typeof r === 'string') return l + r;
      if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
      throw new RuntimeError(`unsupported operand types for + (${typeName(l)} and ${typeName(r)})`, line);
    case '-':
      if (typeof l === 'number' && typeof r === 'number') return l - r;
      throw new RuntimeError(`unsupported operand types for - (${typeName(l)} and ${typeName(r)})`, line);
    case '*':
      if (typeof l === 'number' && typeof r === 'number') return l * r;
      if (typeof l === 'string' && typeof r === 'number' && Number.isInteger(r)) return l.repeat(Math.max(0, r));
      if (typeof l === 'number' && Number.isInteger(l) && typeof r === 'string') return r.repeat(Math.max(0, l));
      if (Array.isArray(l) && typeof r === 'number' && Number.isInteger(r)) {
        const out: unknown[] = [];
        for (let i = 0; i < r; i++) out.push(...l);
        return out;
      }
      throw new RuntimeError(`unsupported operand types for * (${typeName(l)} and ${typeName(r)})`, line);
    case '/':
      if (typeof l === 'number' && typeof r === 'number') {
        if (r === 0) throw new RuntimeError('division by zero', line);
        return l / r;
      }
      throw new RuntimeError(`unsupported operand types for / (${typeName(l)} and ${typeName(r)})`, line);
    case '//':
      if (typeof l === 'number' && typeof r === 'number') {
        if (r === 0) throw new RuntimeError('division by zero', line);
        return Math.floor(l / r);
      }
      throw new RuntimeError(`unsupported operand types for // (${typeName(l)} and ${typeName(r)})`, line);
    case '%':
      if (typeof l === 'number' && typeof r === 'number') {
        if (r === 0) throw new RuntimeError('division by zero', line);
        return pymod(l, r);
      }
      throw new RuntimeError(`unsupported operand types for % (${typeName(l)} and ${typeName(r)})`, line);
    case '**':
      if (typeof l === 'number' && typeof r === 'number') {
        if (l < 0 && !Number.isInteger(r)) throw new RuntimeError('cannot raise negative base to fractional power', line);
        return l ** r;
      }
      throw new RuntimeError(`unsupported operand types for ** (${typeName(l)} and ${typeName(r)})`, line);
    case '==': return eq(l, r);
    case '!=': return !eq(l, r);
    case '<': case '<=': case '>': case '>=':
      return cmp(op, l, r, line);
    default: throw new RuntimeError(`unknown binary op ${op}`, line);
  }
}

// ponytail: flat-env save/restore for function params — works for recursion; globals write-through