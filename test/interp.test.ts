// @ts-nocheck
//
// Track A's parser and interp use bundler-style extensionless imports ('./parser'),
// which Node's native ESM loader cannot resolve. registerHooks teaches the
// loader to retry those specifiers as '.ts'. Registered before the dynamic
// imports below, which must therefore be dynamic rather than static.
//
// @ts-nocheck: this project has no @types/node and tsconfig.json (which must not
// be modified) sets neither "types" nor "allowImportingTsExtensions", so the
// node: builtins and '.ts' import specifiers cannot be type-checked here.

import { registerHooks } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(specifier + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const { parse, ParseError, TokenizeError } = await import('../src/vm/parser.ts');
const { Interp, OpCapError, RuntimeError, OPS_PER_SLICE, HARD_OP_CAP } = await import('../src/vm/interp.ts');
const { makeBuiltins, BUILTINS } = await import('../src/vm/builtins.ts');

// --- helpers -----------------------------------------------------------------

/** Evaluate a single Loam expression and read it back out of the env. */
function evalExpr(src, hardCap) {
  const interp = new Interp(parse(`__r = ${src}\n`), hardCap === undefined ? undefined : { hardCap });
  interp.run();
  return interp.getEnv()['__r'];
}

/** Run a whole Loam program; returns the Interp for env + reports inspection. */
function runProg(src, hardCap) {
  const interp = new Interp(parse(src), hardCap === undefined ? undefined : { hardCap });
  interp.run();
  return interp;
}

// --- arithmetic and precedence ----------------------------------------------

test('arithmetic: precedence', () => {
  assert.equal(evalExpr('2 + 3 * 4'), 14);
  assert.equal(evalExpr('(2 + 3) * 4'), 20);
});

test('arithmetic: ** is right-associative', () => {
  assert.equal(evalExpr('2 ** 3 ** 2'), 512);
});

test('arithmetic: unary minus binds looser than **', () => {
  assert.equal(evalExpr('-2 ** 2'), -4);
});

test('arithmetic: / and //', () => {
  assert.equal(evalExpr('7 / 2'), 3.5);
  assert.equal(evalExpr('7 // 2'), 3);
  assert.equal(evalExpr('7 // -2'), -4);
});

test('arithmetic: % follows divisor sign', () => {
  assert.equal(evalExpr('7 % 3'), 1);
  assert.equal(evalExpr('-7 % 3'), 2);
});

test('arithmetic: division by zero throws', () => {
  assert.throws(() => evalExpr('4 % 0'), (err) => err instanceof RuntimeError && /zero/.test(err.message));
  assert.throws(() => evalExpr('1 / 0'), (err) => err instanceof RuntimeError && /zero/.test(err.message));
});

test('arithmetic: ** yields int for int exponent, float for fractional', () => {
  assert.equal(Number.isInteger(evalExpr('2 ** 0.5')), false);
  assert.equal(Number.isInteger(evalExpr('2 ** 3')), true);
});

// --- strings -----------------------------------------------------------------

test('strings: concat and repeat', () => {
  assert.equal(evalExpr("'ab' + 'cd'"), 'abcd');
  assert.equal(evalExpr("'ab' * 3"), 'ababab');
  assert.equal(evalExpr("3 * 'ab'"), 'ababab');
});

test('strings: str + int throws', () => {
  assert.throws(() => evalExpr("'ab' + 1"), (err) => err instanceof RuntimeError);
});

test('strings: escapes produce real characters', () => {
  assert.equal(evalExpr("'a\\nb'"), 'a\nb');
  assert.equal(evalExpr("'a\\tb'"), 'a\tb');
  assert.equal(evalExpr("'a\\\\b'"), 'a\\b');
  assert.equal(evalExpr("'a\\'b'"), "a'b");
});

test('strings: unterminated string throws TokenizeError', () => {
  assert.throws(() => parse("'abc"), (err) => err instanceof TokenizeError);
});

// --- lists -------------------------------------------------------------------

test('lists: read index, negative index, out of range', () => {
  assert.equal(evalExpr('[1, 2, 3][0]'), 1);
  assert.equal(evalExpr('[1, 2, 3][-1]'), 3);
  assert.throws(() => evalExpr('[1, 2, 3][5]'), (err) => err instanceof RuntimeError);
});

test('lists: assign into index', () => {
  assert.equal(runProg('a = [1, 2]\na[0] = 9\n').getEnv()['a'][0], 9);
  assert.equal(runProg('a = [1, 2]\na[-1] = 9\n').getEnv()['a'][1], 9);
});

test('lists: + concatenates, * repeats', () => {
  assert.deepEqual(evalExpr('[1] + [2]'), [1, 2]);
  assert.deepEqual(evalExpr('[1, 2] * 2'), [1, 2, 1, 2]);
});

test('lists: len is not defined', () => {
  assert.throws(() => evalExpr('len([1])'), (err) => err instanceof RuntimeError && /not defined/.test(err.message));
});

// --- dicts -------------------------------------------------------------------

test('dicts: read existing and missing keys', () => {
  assert.equal(evalExpr("{'a': 1}['a']"), 1);
  assert.throws(() => evalExpr("{'a': 1}['b']"), (err) => err instanceof RuntimeError);
});

test('dicts: assign into key', () => {
  assert.equal(runProg("d = {'a': 1}\nd['a'] = 2\n").getEnv()['d']['a'], 2);
  assert.equal(runProg("d = {}\nd['k'] = 5\n").getEnv()['d']['k'], 5);
});

test('dicts: equality', () => {
  assert.equal(evalExpr("{'a': 1} == {'a': 1}"), true);
  assert.equal(evalExpr("{'a': 1} == {'a': 2}"), false);
  assert.equal(evalExpr("{'a': 1} != {'b': 2}"), true);
});

test('dicts: non-string keys coerce via String()', () => {
  assert.equal(evalExpr("{1: 'x'}[1]"), 'x');
});

// --- if / elif / else ---------------------------------------------------------

test('if: first matching branch wins', () => {
  const env = runProg('r = 0\nif 1 < 2:\n    r = 1\nelif 2 < 3:\n    r = 2\nelse:\n    r = 3\n').getEnv();
  assert.equal(env['r'], 1);
});

test('if: else runs when nothing matches', () => {
  const env = runProg('r = 0\nif 5 < 2:\n    r = 1\nelse:\n    r = 3\n').getEnv();
  assert.equal(env['r'], 3);
});

test('if: nested', () => {
  const env = runProg('r = 0\nif 1 < 2:\n    if 2 < 3:\n        r = 9\n').getEnv();
  assert.equal(env['r'], 9);
});

test('if: elif after else throws ParseError', () => {
  assert.throws(() => parse('if 1:\n    pass\nelse:\n    pass\nelif 1:\n    pass\n'), (err) => err instanceof ParseError);
});

// --- while -------------------------------------------------------------------

test('while: counts to bound', () => {
  assert.equal(runProg('i = 0\nwhile i < 10:\n    i += 1\n').getEnv()['i'], 10);
});

test('while: break exits early', () => {
  assert.equal(runProg('i = 0\nwhile True:\n    i += 1\n    if i == 5:\n        break\n').getEnv()['i'], 5);
});

test('while: continue skips to next iteration', () => {
  const env = runProg('i = 0\nt = 0\nwhile i < 5:\n    i += 1\n    if i == 3:\n        continue\n    t += 1\n').getEnv();
  assert.equal(env['t'], 4);
});

// --- for ---------------------------------------------------------------------

test('for: range(0,5) runs five times, final i == 4', () => {
  const env = runProg('n = 0\nfor i in range(0, 5):\n    n += 1\n').getEnv();
  assert.equal(env['n'], 5);
  assert.equal(env['i'], 4);
});

test('for: empty ranges run zero iterations', () => {
  assert.equal(runProg('n = 0\nfor i in range(3, 3):\n    n += 1\n').getEnv()['n'], 0);
  assert.equal(runProg('n = 0\nfor i in range(3, 1):\n    n += 1\n').getEnv()['n'], 0);
});

test('for: body sums to 10 over range(0,5)', () => {
  assert.equal(runProg('s = 0\nfor i in range(0, 5):\n    s += i\n').getEnv()['s'], 10);
});

test('for: break and continue', () => {
  assert.equal(runProg('n = 0\nfor i in range(0, 10):\n    if i == 3:\n        break\n    n += 1\n').getEnv()['n'], 3);
  assert.equal(runProg('n = 0\nfor i in range(0, 5):\n    if i == 3:\n        continue\n    n += 1\n').getEnv()['n'], 4);
});

test('for: non-range iterable throws ParseError', () => {
  assert.throws(() => parse('for i in [1, 2]:\n    pass\n'), (err) => err instanceof ParseError);
});

// --- def / return ------------------------------------------------------------

test('def: positional args and return', () => {
  assert.equal(runProg('def f(a, b):\n    return a + b\n__r = f(2, 3)\n').getEnv()['__r'], 5);
});

test('def: recursion', () => {
  const src = 'def fact(n):\n    if n <= 1:\n        return 1\n    return n * fact(n - 1)\n__r = fact(5)\n';
  assert.equal(runProg(src).getEnv()['__r'], 120);
});

test('def: missing return yields None', () => {
  assert.equal(runProg('def f():\n    pass\n__r = f()\n').getEnv()['__r'], null);
});

test('def: wrong arg count throws', () => {
  assert.throws(() => runProg('def f(a, b):\n    return a\nf(1)\n'), (err) => err instanceof RuntimeError && /takes/.test(err.message));
});

test('def: calling a non-callable throws', () => {
  assert.throws(() => runProg('x = 1\nx()\n'), (err) => err instanceof RuntimeError);
});

test('def: function reads and writes a global', () => {
  const src = 'g = 0\ndef bump():\n    g = g + 1\nbump()\nbump()\n';
  assert.equal(runProg(src).getEnv()['g'], 2);
});

test('def: nested calls', () => {
  const src = 'def a():\n    return 1\ndef b():\n    return a() + 1\n__r = b()\n';
  assert.equal(runProg(src).getEnv()['__r'], 2);
});

// --- globals -----------------------------------------------------------------

test('globals: read inside a function', () => {
  assert.equal(runProg('g = 7\ndef f():\n    return g\n__r = f()\n').getEnv()['__r'], 7);
});

test('globals: write inside a function is visible outside', () => {
  assert.equal(runProg('g = 1\ndef f():\n    g = 5\nf()\n').getEnv()['g'], 5);
});

test('globals: new global created inside a function is visible outside', () => {
  assert.equal(runProg('def f():\n    z = 42\nf()\n').getEnv()['z'], 42);
});

// --- short-circuit ------------------------------------------------------------

const CALLED = "def f():\n    report('called')\n    return True\n";

test('short-circuit: False and f() does not call f', () => {
  assert.equal(runProg(CALLED + 'r = False and f()\n').reports.length, 0);
});

test('short-circuit: True or f() does not call f', () => {
  assert.equal(runProg(CALLED + 'r = True or f()\n').reports.length, 0);
});

test('short-circuit: True and f() calls f', () => {
  assert.equal(runProg(CALLED + 'r = True and f()\n').reports.length, 1);
});

// --- chained comparison --------------------------------------------------------

test('chained comparison', () => {
  assert.equal(evalExpr('1 < 2 < 3'), true);
  assert.equal(evalExpr('1 < 5 < 3'), false);
  assert.equal(evalExpr('1 < 1 < 2'), false);
});

// --- bool logic ----------------------------------------------------------------

test('bool logic: not', () => {
  assert.equal(evalExpr('not True'), false);
  assert.equal(evalExpr('not 0'), true);
  assert.equal(evalExpr("not ''"), true);
  assert.equal(evalExpr('not None'), true);
  assert.equal(evalExpr('not []'), true);
});

test('bool logic: and / or', () => {
  assert.equal(evalExpr('True and False'), false);
  assert.equal(evalExpr('True or False'), true);
});

// --- truthiness ------------------------------------------------------------------

test('truthiness: if/else picks the expected branch', () => {
  const branch = (test) => {
    const src = `if ${test}:\n    report('t')\nelse:\n    report('f')\n`;
    const reports = runProg(src).reports;
    assert.equal(reports.length, 1);
    return reports[0].includes('t') ? 't' : 'f';
  };
  assert.equal(branch('0'), 'f');
  assert.equal(branch("'x'"), 't');
  assert.equal(branch('[]'), 'f');
  assert.equal(branch('{}'), 'f');
  assert.equal(branch('None'), 'f');
  assert.equal(branch('-1'), 't');
});

// --- augmented assignment ----------------------------------------------------------

test('augmented assign: += -= *= /=', () => {
  assert.equal(runProg('a = 1\na += 2\n').getEnv()['a'], 3);
  assert.equal(runProg('a = 5\na -= 1\n').getEnv()['a'], 4);
  assert.equal(runProg('a = 3\na *= 3\n').getEnv()['a'], 9);
  assert.equal(runProg('a = 5\na /= 2\n').getEnv()['a'], 2.5);
});

// --- member assignment ---------------------------------------------------------------

test('member assign: d.a = 2 updates the dict', () => {
  assert.equal(runProg("d = {'a': 1}\nd.a = 2\n").getEnv()['d']['a'], 2);
});

test('member assign: position().x = 5 is rejected', () => {
  assert.throws(() => parse('position().x = 5\n'), (err) => err instanceof ParseError && err.line === 1 && err.col > 0);
});

// --- step() boundary -------------------------------------------------------------------

test('step(): long loop slices then finishes', () => {
  const interp = new Interp(parse('i = 0\nwhile i < 10000000:\n    i += 1\n'), { hardCap: 200_000_000 });
  assert.equal(interp.step(), 'slice');
  assert.ok(interp.ops >= OPS_PER_SLICE);
  while (interp.step() === 'slice') { /* drain */ }
  assert.equal(interp.getEnv()['i'], 10000000);
});

test('step(): tiny program is done in one step', () => {
  assert.equal(new Interp(parse('x = 1\n')).step(), 'done');
});

test('step(): after run() a further step() returns done', () => {
  assert.equal(runProg('x = 1\n').step(), 'done');
});

// --- op cap ----------------------------------------------------------------------------

test('op cap: while True aborts with an op count', () => {
  const t0 = Date.now();
  assert.throws(
    () => {
      const interp = new Interp(parse('while True:\n    pass\n'), { hardCap: 1000 });
      interp.run();
    },
    (err) => err instanceof OpCapError && err.ops > 1000 && /instruction budget exceeded/.test(err.message),
  );
  assert.ok(Date.now() - t0 < 500, 'must abort fast, not hang');
});

test('op cap: production constant is 50M', () => {
  assert.equal(HARD_OP_CAP, 50_000_000);
});

test('op cap: short program under a small cap does not throw', () => {
  assert.doesNotThrow(() => runProg('x = 1 + 2\n', 100000));
});

// --- error locations ------------------------------------------------------------------------

test('error location: ParseError on line 12', () => {
  const src = ['v0 = 0', 'v1 = 1', 'v2 = 2', 'v3 = 3', 'v4 = 4', 'v5 = 5', 'v6 = 6', 'v7 = 7', 'v8 = 8', 'v9 = 9', 'v10 = 10', 'x ==== 5', ''].join('\n');
  assert.throws(() => parse(src), (err) => err instanceof ParseError && err.line === 12);
});

test('error location: RuntimeError on line 12', () => {
  const src = Array.from({ length: 11 }, () => 'pass').concat(['z = 1 / 0', '']).join('\n');
  assert.throws(() => runProg(src), (err) => err instanceof RuntimeError && err.line === 12);
});

test('error location: tab raises a located TokenizeError', () => {
  assert.throws(() => parse('x = 1\n\ty = 2\n'), (err) => err instanceof TokenizeError && err.line > 0 && err.col > 0);
});

// --- exclusions ------------------------------------------------------------------------------

const isLocatedParseError = (src) => {
  assert.throws(
    () => parse(src),
    (err) => {
      assert.ok(err instanceof ParseError, `expected ParseError, got ${err && err.name}`);
      assert.ok(err.line > 0, 'line must be > 0');
      assert.ok(err.col > 0, 'col must be > 0');
      return true;
    },
  );
};

test('exclusion: class', () => isLocatedParseError('class Foo:\n    pass\n'));
test('exclusion: import', () => isLocatedParseError('import os\n'));
test('exclusion: try/except', () => isLocatedParseError('try:\n    pass\nexcept:\n    pass\n'));
test('exclusion: lambda', () => isLocatedParseError('f = lambda x: x\n'));
test('exclusion: list comprehension', () => isLocatedParseError('y = [x for x in z]\n'));
test('exclusion: dict comprehension', () => isLocatedParseError('y = {k: v for k, v in z}\n'));
test('exclusion: global', () => isLocatedParseError('global x\n'));
test('exclusion: del', () => isLocatedParseError('del a[0]\n'));
test('exclusion: walrus', () => isLocatedParseError('x := 1\n'));
test('exclusion: slice', () => isLocatedParseError('a[1:2]\n'));
test('exclusion: variadic params', () => isLocatedParseError('def f(*args):\n    pass\n'));
test('exclusion: set literal', () => isLocatedParseError('{1, 2}\n'));

// --- builtins ---------------------------------------------------------------------------------

test('builtins: table has 14 entries in the documented order', () => {
  assert.equal(BUILTINS.length, 14);
  assert.deepEqual(BUILTINS.map((b) => b.name), [
    'move', 'descend', 'ascend', 'sense', 'till', 'plant', 'harvest',
    'water', 'wait', 'position', 'inventory', 'set_rule', 'clear_rule', 'report',
  ]);
});

test('builtins: makeBuiltins exposes every documented name', () => {
  const table = makeBuiltins({ reports: [], mote: null, world: null });
  for (const b of BUILTINS) assert.equal(typeof table[b.name], 'function', `${b.name} missing`);
});

test('builtins: report lands in the reports buffer', () => {
  const reports = [];
  makeBuiltins({ reports, mote: null, world: null })['report']('hello');
  assert.equal(reports.length, 1);
});

test('builtins: report stringify format', () => {
  assert.equal(runProg("report('hello')\n").reports[0], 'hello');
  assert.equal(runProg('report(5)\n').reports[0], '5');
  assert.equal(runProg('report(5.5)\n').reports[0], '5.5');
  assert.equal(runProg('report(True)\n').reports[0], 'True');
  assert.equal(runProg('report(None)\n').reports[0], 'None');
  assert.equal(runProg('report(1, 2)\n').reports[0], '1 2');
});

test('builtins: report buffer caps at 200 entries', () => {
  assert.equal(runProg('for i in range(0, 250):\n    report(i)\n').reports.length, 200);
});

test('builtins: the 13 world builtins all raise "not available outside a world"', () => {
  const calls = [
    "move('forward')", 'descend()', 'ascend()', "sense('forward')", 'till()', "plant('wheat')",
    'harvest()', 'water()', 'wait()', 'position()', 'inventory()', "set_rule('harvest', 1)", "clear_rule('harvest')",
  ];
  assert.equal(calls.length, 13);
  for (const call of calls) {
    assert.throws(
      () => runProg(`${call}\n`),
      (err) => err instanceof Error && /not available outside a world/.test(err.message),
      `${call} should report that it needs a world`,
    );
  }
});

test('builtins: arity is checked before the world error', () => {
  assert.throws(
    () => runProg("move('a', 'b')\n"),
    (err) => err instanceof RuntimeError && /takes/.test(err.message) && !/not available outside a world/.test(err.message),
  );
});

test('builtins: wait() is not special in Phase 1', () => {
  assert.throws(() => runProg('wait()\n'), (err) => /wait is not available outside a world/.test(err.message));
});

// --- control flow outside a function ----------------------------------------------------------------

test('module level: return throws', () => {
  assert.throws(() => runProg('return 1\n'), (err) => err instanceof RuntimeError && /return/.test(err.message));
});

test('module level: break throws', () => {
  assert.throws(() => runProg('break\n'), (err) => err instanceof RuntimeError && /break/.test(err.message));
});

// --- type error messages ----------------------------------------------------------------------------------

test('type errors: messages name the offending types', () => {
  assert.throws(() => evalExpr("1 + 'a'"), (err) => err instanceof RuntimeError && /int/.test(err.message));
  assert.throws(() => evalExpr("'a' + 1"), (err) => err instanceof RuntimeError && /str/.test(err.message));
  assert.throws(() => evalExpr("1 < 'a'"), (err) => err instanceof RuntimeError);
});

// --- misc -----------------------------------------------------------------------------------------------------

test('pass counts as an op', () => {
  const interp = new Interp(parse('pass\n'));
  assert.equal(interp.step(), 'done');
  assert.ok(interp.ops >= 1);
});

test('parse-only sanity: set_rule with a def handler parses', () => {
  assert.doesNotThrow(() => parse("def handler(ev):\n    report(ev)\nset_rule('harvest', handler)\n"));
});
