import type { Stmt, Expr } from '../vm/parser';
import { parse } from '../vm/parser';
import { Interp, OpCapError } from '../vm/interp';
import { makeBuiltins } from '../vm/builtins';
import { World } from './world';
import { Mote } from './drone';
import { totalHarvested } from './upgrades';

const TASK_GRID = 10;
const TASK_HARD_CAP = 200_000;
const KEEP_ALIVE_TICKS = 60;

export interface Features {
  hasIf: boolean;
  hasWhile: boolean;
  hasFor: boolean;
  hasDef: boolean;
  hasSense: boolean;
  hasSetRule: boolean;
  hasInventory: boolean;
  hasPosition: boolean;
  hasReport: boolean;
  topLevelLoop: boolean;
  defCallsFunctionInsideLoop: boolean;
}

function emptyFeatures(): Features {
  return {
    hasIf: false,
    hasWhile: false,
    hasFor: false,
    hasDef: false,
    hasSense: false,
    hasSetRule: false,
    hasInventory: false,
    hasPosition: false,
    hasReport: false,
    topLevelLoop: false,
    defCallsFunctionInsideLoop: false,
  };
}

function eachExprInStmt(s: Stmt, fn: (e: Expr) => void): void {
  if (s.kind === 'assign') {
    fn(s.target);
    fn(s.value);
  } else if (s.kind === 'if') {
    for (const b of s.branches) fn(b.test);
  } else if (s.kind === 'while') {
    fn(s.test);
  } else if (s.kind === 'for') {
    fn(s.from);
    fn(s.to);
  } else if (s.kind === 'return' && s.value) {
    fn(s.value);
  } else if (s.kind === 'expr') {
    fn(s.value);
  }
}

function walkExpr(e: Expr, fn: (e: Expr) => void): void {
  fn(e);
  if (e.kind === 'binop') {
    walkExpr(e.left, fn);
    walkExpr(e.right, fn);
  } else if (e.kind === 'unop') {
    walkExpr(e.operand, fn);
  } else if (e.kind === 'call') {
    fn(e.callee);
    for (const a of e.args) walkExpr(a, fn);
  } else if (e.kind === 'index') {
    walkExpr(e.target, fn);
    walkExpr(e.index, fn);
  } else if (e.kind === 'member') {
    walkExpr(e.target, fn);
  } else if (e.kind === 'list') {
    for (const it of e.items) walkExpr(it, fn);
  } else if (e.kind === 'dict') {
    for (const [k, v] of e.entries) {
      walkExpr(k, fn);
      walkExpr(v, fn);
    }
  }
}

function walkStmts(stmts: Stmt[], fn: (s: Stmt) => void): void {
  for (const s of stmts) {
    fn(s);
    if (s.kind === 'if') {
      for (const b of s.branches) walkStmts(b.body, fn);
      if (s.orelse) walkStmts(s.orelse, fn);
    } else if (s.kind === 'while' || s.kind === 'for' || s.kind === 'def') {
      walkStmts(s.body, fn);
    }
  }
}

export function analyze(stmts: Stmt[]): Features {
  const f = emptyFeatures();
  const defNames = new Set<string>();
  for (const s of stmts) if (s.kind === 'def') defNames.add(s.name);

  for (const s of stmts) {
    if (s.kind === 'if') f.hasIf = true;
    else if (s.kind === 'while') f.hasWhile = true;
    else if (s.kind === 'for') f.hasFor = true;
    else if (s.kind === 'def') f.hasDef = true;
    if (s.kind === 'while' || s.kind === 'for') f.topLevelLoop = true;
  }

  walkStmts(stmts, (s) => {
    eachExprInStmt(s, (expr) =>
      walkExpr(expr, (e) => {
        if (e.kind !== 'call' || e.callee.kind !== 'name') return;
        const n = e.callee.id;
        if (n === 'sense') f.hasSense = true;
        else if (n === 'set_rule') f.hasSetRule = true;
        else if (n === 'inventory') f.hasInventory = true;
        else if (n === 'position') f.hasPosition = true;
        else if (n === 'report') f.hasReport = true;
      })
    );
  });

  for (const s of stmts) {
    if (s.kind !== 'def') continue;
    let hasLoop = false;
    let callsPeer = false;
    walkStmts(s.body, (inner) => {
      if (inner.kind === 'while' || inner.kind === 'for') hasLoop = true;
      eachExprInStmt(inner, (expr) =>
        walkExpr(expr, (e) => {
          if (e.kind === 'call' && e.callee.kind === 'name' && defNames.has(e.callee.id)) callsPeer = true;
        })
      );
    });
    if (hasLoop && callsPeer) f.defCallsFunctionInsideLoop = true;
  }

  return f;
}

export interface TaskTrace {
  reports: string[];
  events: string[];
  opsUsed: number;
  aborted: boolean;
  userCalls: number;
  harvested: number;
  inventory: Record<string, number>;
  moves: number;
  ruleFires: Record<string, number>;
  features: Features;
  parseError: string | null;
}

export interface RunOptions {
  keepAliveTicks?: number;
  hardCap?: number;
}

export function runTask(source: string, opts: RunOptions = {}): TaskTrace {
  const keepAlive = opts.keepAliveTicks ?? KEEP_ALIVE_TICKS;
  const reports: string[] = [];
  const world = new World({ width: TASK_GRID, height: TASK_GRID });
  const mote = new Mote();

  let stmts: Stmt[];
  try {
    stmts = parse(source);
  } catch (e) {
    return {
      reports: [],
      events: [],
      opsUsed: 0,
      aborted: false,
      userCalls: 0,
      harvested: 0,
      inventory: {},
      moves: 0,
      ruleFires: {},
      features: emptyFeatures(),
      parseError: e instanceof Error ? e.message : String(e),
    };
  }

  const features = analyze(stmts);
  const events: string[] = [];
  const ruleFires: Record<string, number> = {};

  const builtins = makeBuiltins({ reports, mote, world });
  const baseMove = builtins['move'];
  let moves = 0;
  builtins['move'] = (dir: unknown): unknown => {
    const ok = baseMove(dir);
    if (ok) moves++;
    return ok;
  };

  const interp = new Interp(stmts, { builtins, hardCap: opts.hardCap ?? TASK_HARD_CAP });
  let aborted = false;

  // Count events pending before this dispatch, only for kinds with a bound rule.
  const dispatchRound = (): void => {
    for (const ev of mote.pending) {
      if (mote.rules.has(ev.kind)) ruleFires[ev.kind] = (ruleFires[ev.kind] ?? 0) + 1;
      events.push(ev.kind);
    }
    try {
      mote.dispatch((fn, ctx) => interp.callRule(fn, ctx));
    } catch (e) {
      if (e instanceof OpCapError) aborted = true;
    }
    for (const ev of mote.pending) events.push(ev.kind);
  };

  try {
    interp.run();
  } catch (e) {
    if (e instanceof OpCapError) aborted = true;
  }
  dispatchRound();

  // Keep the simulation alive after the top-level program ends so rule-driven
  // programs (no top-level loop) can still act.
  for (let t = 0; t < keepAlive; t++) {
    world.tick(mote);
    dispatchRound();
  }

  return {
    reports: [...reports],
    events,
    opsUsed: interp.ops,
    aborted,
    userCalls: interp.userCalls,
    harvested: totalHarvested(mote.inventory),
    inventory: { ...mote.inventory },
    moves,
    ruleFires,
    features,
    parseError: null,
  };
}

export interface TaskDef {
  id: number;
  name: string;
  concept: string;
  hint: string;
  starter: string;
  check(t: TaskTrace): boolean;
  referencePass: string;
  referenceFail: string;
}

const NAIVE_FARM = [
  "till()",
  "plant('kelp')",
  'water()',
  'wait()',
  'wait()',
  'wait()',
  'water()',
  'water()',
  'harvest()',
  'report(1)',
  'report(2)',
].join('\n');

const OPTIMIZED_FARM = [
  "till()",
  "plant('kelp')",
  'water()',
  'wait()',
  'wait()',
  'wait()',
  'harvest()',
].join('\n');

let baselineOps = 0;
function getBaselineOps(): number {
  if (baselineOps === 0) baselineOps = runTask(NAIVE_FARM, { keepAliveTicks: 0 }).opsUsed || 1;
  return baselineOps;
}

export const TASKS: TaskDef[] = [
  {
    id: 1,
    name: 'Say something',
    concept: 'variables and report',
    hint: 'Use report() so the console shows your text.',
    starter: "report('hello')\n",
    check: (t) => t.reports.some((r) => r.trim().length > 0),
    referencePass: "report('hello')\n",
    referenceFail: 'x = 1\n',
  },
  {
    id: 2,
    name: 'Look before you leap',
    concept: 'sense and if',
    hint: "Read a direction with sense(), then branch with if.",
    starter: "d = sense('forward')\nif d == 'soil':\n    report('soil ahead')\n",
    check: (t) => t.features.hasSense && t.features.hasIf && t.reports.length > 0,
    referencePass: "d = sense('back')\nif d == 'soil':\n    report('ok')\n",
    referenceFail: "report('no sensing')\n",
  },
  {
    id: 3,
    name: 'Do not stop',
    concept: 'while',
    hint: 'A while loop can move the Mote many times.',
    starter: 'n = 0\nwhile n < 12:\n    move("back")\n    n += 1\n',
    check: (t) => t.features.hasWhile && t.moves >= 10,
    referencePass: 'n = 0\nwhile n < 12:\n    move("back")\n    move("forward")\n    n += 1\n',
    referenceFail: "move('back')\nmove('forward')\n",
  },
  {
    id: 4,
    name: 'Count your steps',
    concept: 'loop counters and budget',
    hint: 'Make the loop end on a counter, not run forever.',
    starter: 'n = 0\nwhile n < 20:\n    move("back")\n    n += 1\n',
    check: (t) => t.features.hasWhile && !t.aborted,
    referencePass: 'n = 0\nwhile n < 20:\n    move("back")\n    n += 1\n',
    referenceFail: 'while True:\n    pass\n',
  },
  {
    id: 5,
    name: 'A fixed number of times',
    concept: 'for over range',
    hint: 'for i in range(0, n) runs the body exactly n times.',
    starter: 'total = 0\nfor i in range(0, 5):\n    total += 1\nreport(total)\n',
    check: (t) => t.features.hasFor && !t.aborted && t.reports.length > 0,
    referencePass: 'total = 0\nfor i in range(0, 5):\n    total += 1\nreport(total)\n',
    referenceFail: "report('no loop')\n",
  },
  {
    id: 6,
    name: 'Name the motion',
    concept: 'def and return',
    hint: 'Define a function with def and call it several times.',
    starter: 'def step(x):\n    return x + 1\nstep(1)\nstep(2)\nstep(3)\n',
    check: (t) => t.features.hasDef && t.userCalls >= 3,
    referencePass: 'def step(x):\n    return x + 1\nstep(1)\nstep(2)\nstep(3)\n',
    referenceFail: 'def step(x):\n    return x + 1\nstep(1)\n',
  },
  {
    id: 7,
    name: 'One farm, one function',
    concept: 'composition',
    hint: 'A function with a loop can call another function that also loops.',
    starter: 'def one():\n    return 1\ndef many():\n    total = 0\n    for i in range(0, 3):\n        total += one()\n    return total\nmany()\n',
    check: (t) => t.features.defCallsFunctionInsideLoop && !t.aborted,
    referencePass: 'def one():\n    return 1\ndef many():\n    total = 0\n    for i in range(0, 3):\n        total += one()\n    return total\nmany()\n',
    referenceFail: 'def many():\n    total = 0\n    for i in range(0, 3):\n        total += 1\n    return total\nmany()\n',
  },
  {
    id: 8,
    name: 'Do not carry everything',
    concept: 'dicts and inventory()',
    hint: 'inventory() returns a dict; branch on a key before planting.',
    starter: "inv = inventory()\nif inv == {}:\n    report('empty bag')\n",
    check: (t) => t.features.hasInventory && t.features.hasIf && !t.aborted,
    referencePass: "inv = inventory()\nif inv == {}:\n    report('empty bag')\n",
    referenceFail: "report('no inventory')\n",
  },
  {
    id: 9,
    name: 'Let the rules run',
    concept: 'set_rule',
    hint: 'Bind a rule with set_rule so the farm runs without a main loop.',
    starter: "def on_harvest(ctx):\n    plant('kelp')\ndef on_tick(ctx):\n    water()\n    harvest()\ntill()\nplant('kelp')\nset_rule('harvest', on_harvest)\nset_rule('tick', on_tick)\n",
    check: (t) => t.features.hasSetRule && !t.features.topLevelLoop && (t.ruleFires['harvest'] ?? 0) >= 3,
    referencePass: "def on_harvest(ctx):\n    plant('kelp')\ndef on_tick(ctx):\n    water()\n    harvest()\ntill()\nplant('kelp')\nset_rule('harvest', on_harvest)\nset_rule('tick', on_tick)\n",
    referenceFail: "def on_tick(ctx):\n    report('tick')\nset_rule('tick', on_tick)\n",
  },
  {
    id: 10,
    name: 'The tight island',
    concept: 'optimisation',
    hint: 'Finish a farm cycle in at least 40% fewer operations.',
    starter: OPTIMIZED_FARM,
    check: (t) => t.opsUsed > 0 && t.opsUsed <= getBaselineOps() * 0.6,
    referencePass: OPTIMIZED_FARM,
    referenceFail: NAIVE_FARM,
  },
];

export function evaluateTask(task: TaskDef, source: string): { passed: boolean; trace: TaskTrace } {
  const trace = runTask(source);
  if (trace.parseError !== null) return { passed: false, trace };
  return { passed: task.check(trace), trace };
}