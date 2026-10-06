export type TokenType = 'NUM' | 'STR' | 'NAME' | 'KEYWORD' | 'OP' | 'NEWLINE' | 'INDENT' | 'DEDENT' | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

export class TokenizeError extends Error {
  line: number;
  col: number;
  constructor(message: string, line: number, col: number) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'TokenizeError';
    this.line = line;
    this.col = col;
  }
}

const KEYWORDS = new Set([
  'if', 'elif', 'else', 'while', 'for', 'in', 'range', 'def',
  'return', 'break', 'continue', 'and', 'or', 'not',
  'True', 'False', 'None', 'pass',
]);

// ponytail: `#` comments are lexer sugar, not part of the DESIGN.md 1.1 grammar.
const OPS3 = ['//=', '**='];
const OPS2 = ['**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', ':='];
const OPS1 = ['<', '>', '=', '+', '-', '*', '/', '%', '(', ')', '[', ']', '{', '}', ',', ':', '.'];

const ESCAPES: Record<string, string | undefined> = { n: '\n', t: '\t', '\\': '\\', '"': '"', "'": "'" };

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isNameStart = (c: string | undefined): boolean => c !== undefined && (c === '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'));
const isNamePart = (c: string | undefined): boolean => c !== undefined && (c === '_' || isDigit(c) || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'));

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  const indents: number[] = [0];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  let atLineStart = true;
  let lineHasTokens = false;
  let lastLine = 1;
  let lastCol = 1;

  const col = (): number => i - lineStart + 1;

  const emit = (type: TokenType, value: string, atLine = line, atCol = col()): void => {
    toks.push({ type, value, line: atLine, col: atCol });
    if (type === 'NEWLINE') return;
    lastLine = atLine;
    lastCol = atCol;
    if (type !== 'INDENT' && type !== 'DEDENT') lineHasTokens = true;
  };

  while (i < src.length) {
    if (atLineStart) {
      atLineStart = false;
      let spaces = 0;
      while (src[i] === ' ') { i++; spaces++; }
      const c: string | undefined = src[i];
      if (c !== undefined && c !== '\n' && c !== '\r' && c !== '#') {
        if (spaces % 4 !== 0) throw new TokenizeError('indentation must be a multiple of 4 spaces', line, spaces - (spaces % 4) + 1);
        const level = spaces / 4;
        const top = indents[indents.length - 1];
        const atCol = spaces + 1;
        if (level > top) {
          for (let lv = top + 1; lv <= level; lv++) { indents.push(lv); emit('INDENT', '', line, atCol); }
        } else if (level < top) {
          while (indents[indents.length - 1] > level) { indents.pop(); emit('DEDENT', '', line, atCol); }
          if (indents[indents.length - 1] !== level) throw new TokenizeError('unindent does not match any outer indentation level', line, atCol);
        }
      }
      continue;
    }

    const c: string = src[i];

    if (c === ' ' || c === '\t') {
      if (c === '\t') throw new TokenizeError('tabs are not allowed; use spaces', line, col());
      i++;
      continue;
    }

    if (c === '\n' || c === '\r') {
      const atCol = col();
      if (c === '\r' && src[i + 1] === '\n') i++;
      i++;
      if (lineHasTokens) emit('NEWLINE', '\n', line, atCol);
      line++;
      lineStart = i;
      atLineStart = true;
      lineHasTokens = false;
      continue;
    }

    if (c === '#') {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }

    if (isDigit(c)) {
      const atCol = col();
      const start = i;
      while (isDigit(src[i])) i++;
      if (src[i] === '.') {
        if (!isDigit(src[i + 1])) throw new TokenizeError("number needs a digit after the decimal point", line, i - lineStart + 1);
        i++;
        while (isDigit(src[i])) i++;
      }
      if (isNameStart(src[i])) throw new TokenizeError(`invalid number literal '${src.slice(start, i + 1)}'`, line, atCol);
      emit('NUM', src.slice(start, i), line, atCol);
      continue;
    }

    if (c === '"' || c === "'") {
      const openLine = line;
      const openCol = col();
      i++;
      let out = '';
      for (;;) {
        const ch: string | undefined = src[i];
        if (ch === undefined || ch === '\n' || ch === '\r') throw new TokenizeError('unterminated string literal', openLine, openCol);
        if (ch === '\t') throw new TokenizeError('tabs are not allowed; use spaces', line, col());
        if (ch === '\\') {
          const esc: string | undefined = src[i + 1];
          const rep = esc === undefined ? undefined : ESCAPES[esc];
          if (rep === undefined) {
            if (esc === undefined || esc === '\n' || esc === '\r') throw new TokenizeError('unterminated string literal', openLine, openCol);
            throw new TokenizeError(`unknown escape sequence '\\${esc}'`, line, col() + 1);
          }
          out += rep;
          i += 2;
          continue;
        }
        if (ch === c) { i++; break; }
        out += ch;
        i++;
      }
      emit('STR', out, openLine, openCol);
      continue;
    }

    if (isNameStart(c)) {
      const atCol = col();
      const start = i;
      while (isNamePart(src[i])) i++;
      const word = src.slice(start, i);
      emit(KEYWORDS.has(word) ? 'KEYWORD' : 'NAME', word, line, atCol);
      continue;
    }

    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    const atCol = col();
    if (OPS3.includes(three)) { emit('OP', three, line, atCol); i += 3; continue; }
    if (OPS2.includes(two)) { emit('OP', two, line, atCol); i += 2; continue; }
    if (OPS1.includes(c)) { emit('OP', c, line, atCol); i += 1; continue; }

    throw new TokenizeError(`unexpected character '${c}'`, line, atCol);
  }

  if (lineHasTokens) emit('NEWLINE', '\n', line, col());
  while (indents.length > 1) { indents.pop(); emit('DEDENT', '', lastLine, lastCol); }
  toks.push({ type: 'EOF', value: '', line, col: i - lineStart + 1 });
  return toks;
}
