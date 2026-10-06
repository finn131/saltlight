import { tokenize, type Token, type TokenType } from './tokenizer';

export class ParseError extends Error {
  line: number;
  col: number;
  constructor(message: string, line: number, col: number) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'ParseError';
    this.line = line;
    this.col = col;
  }
}

export type Stmt =
  | { kind: 'assign'; target: Expr; value: Expr; line: number; op?: string }
  | { kind: 'if'; branches: { test: Expr; body: Stmt[] }[]; orelse: Stmt[] | null; line: number }
  | { kind: 'while'; test: Expr; body: Stmt[]; line: number }
  | { kind: 'for'; name: string; from: Expr; to: Expr; body: Stmt[]; line: number }
  | { kind: 'def'; name: string; params: string[]; body: Stmt[]; line: number }
  | { kind: 'return'; value: Expr | null; line: number }
  | { kind: 'break' | 'continue'; line: number }
  | { kind: 'pass'; line: number }
  | { kind: 'expr'; value: Expr; line: number };

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'none' }
  | { kind: 'name'; id: string; line: number }
  | { kind: 'binop'; op: string; left: Expr; right: Expr; line: number }
  | { kind: 'unop'; op: string; operand: Expr; line: number }
  | { kind: 'call'; callee: Expr; args: Expr[]; line: number }
  | { kind: 'index'; target: Expr; index: Expr; line: number }
  | { kind: 'member'; target: Expr; name: string; line: number }
  | { kind: 'list'; items: Expr[]; line: number }
  | { kind: 'dict'; entries: [Expr, Expr][]; line: number };

const AUG_OPS = new Set(['+=', '-=', '*=', '/=']);
const CMP_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);
const FORBIDDEN_STATEMENT_START = new Set([
  'class', 'import', 'from', 'require', 'try', 'except', 'finally',
  'raise', 'yield', 'with', 'global', 'nonlocal', 'del', 'assert',
  'async', 'await', 'lambda', 'match', 'case',
]);

function lineOf(e: Expr, fallback: number): number {
  return 'line' in e ? e.line : fallback;
}

class Parser {
  private toks: Token[];
  private i = 0;

  constructor(toks: Token[]) { this.toks = toks; }

  private peek(off = 0): Token { return this.toks[Math.min(this.i + off, this.toks.length - 1)]; }
  private next(): Token { return this.toks[this.i++]; }
  private at(type: TokenType, value?: string): boolean { const t = this.peek(); return t.type === type && (value === undefined || t.value === value); }
  private expect(type: TokenType, value?: string): Token {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) throw this.err(`expected ${value ?? type}, got ${this.desc(t)}`, t);
    return this.next();
  }
  private err(msg: string, t = this.peek()): ParseError { return new ParseError(msg, t.line, t.col); }
  private desc(t: Token): string {
    if (t.type === 'EOF') return 'end of file';
    if (t.type === 'NEWLINE') return 'end of line';
    return `'${t.value}'`;
  }

  program(): Stmt[] {
    const out: Stmt[] = [];
    while (!this.at('EOF')) out.push(this.statement());
    return out;
  }

  private statement(): Stmt {
    const t = this.peek();

    if (t.type === 'KEYWORD') {
      switch (t.value) {
        case 'if': return this.ifStmt();
        case 'while': return this.whileStmt();
        case 'for': return this.forStmt();
        case 'def': return this.defStmt();
        case 'return': return this.returnStmt();
        case 'break': this.next(); this.endStmt(); return { kind: 'break', line: t.line };
        case 'continue': this.next(); this.endStmt(); return { kind: 'continue', line: t.line };
        case 'pass': this.next(); this.endStmt(); return { kind: 'pass', line: t.line };
        case 'elif': throw this.err("'elif' without a matching 'if'", t);
        case 'else': throw this.err("'else' without a matching 'if'", t);
      }
    }

    if (t.type === 'NAME') {
      if (FORBIDDEN_STATEMENT_START.has(t.value)) throw this.err(`${t.value} is not supported in Loam`, t);
    }

    return this.exprOrAssign();
  }

  private endStmt(): void {
    if (this.at('NEWLINE')) { this.next(); return; }
    throw this.err(`expected newline, got ${this.desc(this.peek())}`);
  }

  private exprOrAssign(): Stmt {
    const start = this.peek();
    const target = this.expr();
    const t = this.peek();

    if (t.type === 'OP' && t.value === ':=') throw this.err('walrus operator (:=) is not supported in Loam', t);

    if (t.type === 'OP' && (t.value === '=' || AUG_OPS.has(t.value))) {
      this.next();
      this.validateTarget(target, t);
      const value = this.expr();
      this.endStmt();
      return { kind: 'assign', target, value, line: start.line, op: t.value === '=' ? undefined : t.value };
    }

    this.endStmt();
    return { kind: 'expr', value: target, line: start.line };
  }

  private validateTarget(e: Expr, tok: Token): void {
    let cur: Expr = e;
    while (true) {
      if (cur.kind === 'name') return;
      if (cur.kind === 'index' || cur.kind === 'member') { cur = cur.target; continue; }
      throw this.err(`cannot assign to ${cur.kind}`, tok);
    }
  }

  private ifStmt(): Stmt {
    const start = this.next();
    const test = this.expr();
    this.expect('OP', ':');
    const branches = [{ test, body: this.block() }];
    let orelse: Stmt[] | null = null;

    while (this.at('KEYWORD', 'elif')) {
      this.next();
      const t = this.expr();
      this.expect('OP', ':');
      branches.push({ test: t, body: this.block() });
    }

    if (this.at('KEYWORD', 'else')) {
      this.next();
      this.expect('OP', ':');
      orelse = this.block();
      if (this.at('KEYWORD', 'elif')) throw this.err("'elif' after 'else' is not allowed", this.peek());
    }
    return { kind: 'if', branches, orelse, line: start.line };
  }

  private whileStmt(): Stmt {
    const start = this.next();
    const test = this.expr();
    this.expect('OP', ':');
    const body = this.block();
    return { kind: 'while', test, body, line: start.line };
  }

  private forStmt(): Stmt {
    const start = this.next();
    const nameTok = this.expect('NAME');
    this.expect('KEYWORD', 'in');
    if (!this.at('KEYWORD', 'range')) throw this.err("Loam 'for' requires range(from, to)", this.peek());
    this.next();
    this.expect('OP', '(');
    const from = this.expr();
    this.expect('OP', ',');
    const to = this.expr();
    this.expect('OP', ')');
    this.expect('OP', ':');
    const body = this.block();
    return { kind: 'for', name: nameTok.value, from, to, body, line: start.line };
  }

  private defStmt(): Stmt {
    const start = this.next();
    const nameTok = this.expect('NAME');
    this.expect('OP', '(');
    const params: string[] = [];
    if (!this.at('OP', ')')) {
      for (;;) {
        if (this.at('OP', '*') || this.at('OP', '**')) throw this.err('variadic parameters are not supported in Loam', this.peek());
        params.push(this.expect('NAME').value);
        if (this.at('OP', ',')) { this.next(); continue; }
        break;
      }
    }
    this.expect('OP', ')');
    this.expect('OP', ':');
    const body = this.block();
    return { kind: 'def', name: nameTok.value, params, body, line: start.line };
  }

  private returnStmt(): Stmt {
    const t = this.next();
    let value: Expr | null = null;
    if (!this.at('NEWLINE')) value = this.expr();
    this.endStmt();
    return { kind: 'return', value, line: t.line };
  }

  private block(): Stmt[] {
    this.expect('NEWLINE');
    if (!this.at('INDENT')) throw this.err('expected indented block', this.peek());
    this.next();
    const body: Stmt[] = [];
    while (!this.at('DEDENT') && !this.at('EOF')) body.push(this.statement());
    if (body.length === 0) throw this.err('expected indented block', this.peek());
    this.expect('DEDENT');
    return body;
  }

  private expr(): Expr { return this.orExpr(); }

  private orExpr(): Expr {
    let left = this.andExpr();
    while (this.at('KEYWORD', 'or')) { const op = this.next(); const right = this.andExpr(); left = { kind: 'binop', op: 'or', left, right, line: op.line }; }
    return left;
  }

  private andExpr(): Expr {
    let left = this.notExpr();
    while (this.at('KEYWORD', 'and')) { const op = this.next(); const right = this.notExpr(); left = { kind: 'binop', op: 'and', left, right, line: op.line }; }
    return left;
  }

  private notExpr(): Expr {
    if (this.at('KEYWORD', 'not')) { const op = this.next(); const operand = this.notExpr(); return { kind: 'unop', op: 'not', operand, line: op.line }; }
    return this.comparison();
  }

  private comparison(): Expr {
    let left = this.arith();
    if (!CMP_OPS.has(this.peek().value) || this.peek().type !== 'OP') return left;

    const parts: { op: string; right: Expr; line: number }[] = [];
    while (this.at('OP') && CMP_OPS.has(this.peek().value)) {
      const opTok = this.next();
      const right = this.arith();
      parts.push({ op: opTok.value, right, line: opTok.line });
    }

    let acc: Expr = { kind: 'binop', op: parts[0].op, left, right: parts[0].right, line: parts[0].line };
    for (let k = 1; k < parts.length; k++) {
      const mid = parts[k - 1].right;
      const right: Expr = { kind: 'binop', op: parts[k].op, left: mid, right: parts[k].right, line: parts[k].line };
      acc = { kind: 'binop', op: 'and', left: acc, right, line: parts[0].line };
    }
    // ponytail: chained comparison duplicates middle expr; safe for pure exprs
    return acc;
  }

  private arith(): Expr {
    let left = this.term();
    while (this.at('OP') && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next();
      const right = this.term();
      left = { kind: 'binop', op: op.value, left, right, line: op.line };
    }
    return left;
  }

  private term(): Expr {
    let left = this.factor();
    while (this.at('OP') && ['*', '/', '//', '%'].includes(this.peek().value)) {
      const op = this.next();
      const right = this.factor();
      left = { kind: 'binop', op: op.value, left, right, line: op.line };
    }
    return left;
  }

  private factor(): Expr {
    if (this.at('OP') && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next();
      const operand = this.factor();
      return { kind: 'unop', op: op.value, operand, line: op.line };
    }
    return this.power();
  }

  private power(): Expr {
    let base = this.atom();
    if (this.at('OP', '**')) {
      const op = this.next();
      const right = this.factor();
      base = { kind: 'binop', op: op.value, left: base, right, line: op.line };
    }
    return base;
  }

  private atom(): Expr { return this.postfix(this.primary()); }

  private primary(): Expr {
    const t = this.peek();

    if (t.type === 'NUM') { this.next(); return { kind: 'num', value: Number(t.value) }; }
    if (t.type === 'STR') { this.next(); return { kind: 'str', value: t.value }; }
    if (t.type === 'KEYWORD') {
      if (t.value === 'True') { this.next(); return { kind: 'bool', value: true }; }
      if (t.value === 'False') { this.next(); return { kind: 'bool', value: false }; }
      if (t.value === 'None') { this.next(); return { kind: 'none' }; }
      throw this.err(`unexpected keyword '${t.value}' in expression`, t);
    }
    if (t.type === 'NAME') {
      if (t.value === 'lambda') throw this.err('lambda is not supported in Loam', t);
      this.next();
      if (this.at('OP', '(')) return this.callTail(t);
      return { kind: 'name', id: t.value, line: t.line };
    }
    if (t.type === 'OP') {
      if (t.value === '(') { this.next(); const e = this.expr(); this.expect('OP', ')'); return e; }
      if (t.value === '[') return this.listLit(t);
      if (t.value === '{') return this.dictLit(t);
      if (t.value === ':=') throw this.err('walrus operator (:=) is not supported in Loam', t);
    }
    throw this.err(`unexpected token ${this.desc(t)}`, t);
  }

  private callTail(nameTok: Token): Expr {
    this.expect('OP', '(');
    const args: Expr[] = [];
    if (!this.at('OP', ')')) {
      for (;;) {
        if (this.at('OP', '*') || this.at('OP', '**')) throw this.err('argument unpacking (* / **) is not supported in Loam', this.peek());
        args.push(this.expr());
        if (this.at('OP', ',')) { this.next(); continue; }
        break;
      }
    }
    this.expect('OP', ')');
    return { kind: 'call', callee: { kind: 'name', id: nameTok.value, line: nameTok.line }, args, line: nameTok.line };
  }

  private postfix(base: Expr): Expr {
    for (;;) {
      if (this.at('OP', '[')) {
        const br = this.next();
        const idx = this.expr();
        if (this.at('OP', ':')) throw this.err('slices are not supported in Loam', this.peek());
        this.expect('OP', ']');
        base = { kind: 'index', target: base, index: idx, line: lineOf(base, br.line) };
        continue;
      }
      if (this.at('OP', '.')) {
        const dot = this.next();
        const n = this.expect('NAME');
        base = { kind: 'member', target: base, name: n.value, line: lineOf(base, dot.line) };
        continue;
      }
      return base;
    }
  }

  private listLit(openTok: Token): Expr {
    this.expect('OP', '[');
    const items: Expr[] = [];
    if (!this.at('OP', ']')) {
      for (;;) {
        items.push(this.expr());
        if (this.at('KEYWORD', 'for')) throw this.err('list comprehensions are not supported in Loam', this.peek());
        if (this.at('OP', ',')) { this.next(); continue; }
        break;
      }
    }
    this.expect('OP', ']');
    return this.postfix({ kind: 'list', items, line: openTok.line });
  }

  private dictLit(openTok: Token): Expr {
    this.expect('OP', '{');
    const entries: [Expr, Expr][] = [];
    if (!this.at('OP', '}')) {
      for (;;) {
        if (this.at('KEYWORD', 'for')) throw this.err('dict comprehensions are not supported in Loam', this.peek());
        const k = this.expr();
        if (this.at('OP', '*') || this.at('OP', '**')) throw this.err('argument unpacking (* / **) is not supported in Loam', this.peek());
        if (!this.at('OP', ':')) throw this.err('set literals are not supported in Loam; use dict {key: value}', this.peek());
        this.next();
        const v = this.expr();
        entries.push([k, v]);
        if (this.at('KEYWORD', 'for')) throw this.err('dict comprehensions are not supported in Loam', this.peek());
        if (this.at('OP', ',')) { this.next(); continue; }
        break;
      }
    }
    this.expect('OP', '}');
    return this.postfix({ kind: 'dict', entries, line: openTok.line });
  }
}

export function parse(src: string): Stmt[] {
  return new Parser(tokenize(src)).program();
}

export { tokenize, type Token, type TokenType, TokenizeError } from './tokenizer';